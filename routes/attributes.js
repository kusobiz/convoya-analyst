import { Router } from 'express';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');

// Not readonly (unlike the other routes/*.js files) — this module owns zone_attributes, a
// small persistent table that lives alongside master_stock in the same file. Safe across
// monthly data refreshes: scripts/excel_to_sqlite.py only replaces the master_stock table
// (`if_exists='replace'`), it never touches other tables in stock.db.
//
// zone_attributes is the owner-curated ground truth for how each Branch/Zone/Suite/Lot Type
// was actually designed and priced (tier, era, religion zoning, physical traits) — seeded once
// via scripts/seed_zone_attributes.js, then extended over time through the Attribute Registry
// form in the Product Attributes tab. It replaced an earlier percentile-based "compute the
// tier from the price data itself" approach, which couldn't distinguish a zone that's
// underpriced from one that was simply never meant to be premium.
let db = null;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS zone_attributes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch TEXT NOT NULL,
        zone TEXT NOT NULL,
        suite_no TEXT,
        lot_type TEXT,
        intended_tier TEXT,
        era TEXT,
        religion_type TEXT,
        walkway_width TEXT,
        walkway_proximity TEXT,
        gazebo_proximity TEXT,
        elevation_tier TEXT,
        notes TEXT,
        product_type TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_zone_attributes_lookup ON zone_attributes(branch, zone, suite_no, lot_type)`);
    const existingCols = db.prepare(`PRAGMA table_info(zone_attributes)`).all().map(c => c.name);
    if (!existingCols.includes('product_type')) db.exec(`ALTER TABLE zone_attributes ADD COLUMN product_type TEXT`);

    // plot_position_signals holds inferred (not measured) candidates from
    // scripts/detect_plot_signals.js — created here too so the API doesn't 500 on a fresh DB
    // before the detection script has ever been run.
    db.exec(`
      CREATE TABLE IF NOT EXISTS plot_position_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_no TEXT NOT NULL UNIQUE,
        branch TEXT,
        zone TEXT,
        row TEXT,
        lot_number INTEGER,
        signal_type TEXT,
        evidence TEXT,
        current_price REAL,
        current_sell_through_pct REAL,
        review_status TEXT DEFAULT 'Pending',
        reviewed_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_plot_signals_lookup ON plot_position_signals(branch, zone, signal_type, review_status)`);
  }
  return db;
}

function toArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

// "Big Lot" = Unit Price >= 500,000 MYR, matching the existing "≥500k" Price Range tier.
function bigLotClause(bigLotFilter) {
  if (bigLotFilter === 'exclude') return `"Unit Price" < 500000`;
  if (bigLotFilter === 'only') return `"Unit Price" >= 500000`;
  return null;
}

const FILTER_COLUMNS = {
  branch:      'Branch',
  productType: 'Material Type Desc.',
  zone:        'Zone',
  lotType:     'Lot Type',
  suiteNo:     'Suite No',
};

// Every filter accepts either a single value or an array — empty/missing means "All" (no
// filter). Mirrors routes/lifecycle.js's buildWhere exactly.
function buildWhere(filters, extraClauses = []) {
  const clauses = [...extraClauses];
  const params = [];
  for (const [key, col] of Object.entries(FILTER_COLUMNS)) {
    const list = toArray(filters[key])
      .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
      .map(v => String(v).trim().toUpperCase());
    if (list.length) {
      const placeholders = list.map(() => '?').join(', ');
      clauses.push(`UPPER(TRIM("${col}")) IN (${placeholders})`);
      params.push(...list);
    }
  }
  const bigLot = bigLotClause(filters.bigLotFilter);
  if (bigLot) clauses.push(bigLot);
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

// ── Section 1: Zone Tier Analysis ──

const VALID_TIERS = new Set(['High', 'Mid', 'Low']);
// Both spellings are recognized: the owner-confirmed rule name and the source data's actual
// (typo'd) Lot Type value — see scripts/seed_zone_attributes.js for the full explanation.
const UNIVERSAL_HIGH_LOT_TYPES = new Set(['SUPER FAMILY', 'ROYAL FAMILY', 'ROYAL FAMLIY']);
const FAMILY_LOT_TYPE = 'FAMILY';

function norm(s) {
  return String(s ?? '').trim().toUpperCase();
}

// A zone_attributes text field matches an actual value either exactly, or (for rows storing a
// bare prefix, e.g. zone 'BK-', suite 'HB-') when the actual value starts with it — "exact
// match unless noted as prefix", with no separate schema flag needed since exact rows simply
// never collide with real prefix values (a real Zone/Suite No like 'BK-A' never equals 'BK-').
function textMatches(ruleVal, actualVal) {
  const r = norm(ruleVal), a = norm(actualVal);
  if (!r || !a) return false;
  return r === a || a.startsWith(r);
}

// Among candidate rows, an exact match on `field` wins outright; otherwise the longest
// (most specific) prefix match wins.
function pickMostSpecific(rows, field, actualVal) {
  if (!rows.length) return null;
  const a = norm(actualVal);
  const exact = rows.find(r => norm(r[field]) === a);
  if (exact) return exact;
  return rows.reduce((best, r) => (!best || norm(r[field]).length > norm(best[field]).length) ? r : best, null);
}

// Resolves the owner-curated expected tier (+ era, for peer grouping) for one aggregated row,
// trying — in priority order — the universal Burial Plot lot-type rule, then a suite-specific
// zone_attributes row, then a zone-wide one. A suite-specific row with no intended_tier set
// (e.g. a Family-Suite or Christian-zone flag row) falls through to its zone's tier rather than
// leaving expectedTier blank, since those rows exist to record a *different* attribute, not to
// override the tier.
function lookupZoneAttribute(allRows, { branch, zone, suiteNo, lotTypeFilter }) {
  const lotTypes = (lotTypeFilter || []).map(norm).filter(Boolean);
  if (lotTypes.length === 1 && UNIVERSAL_HIGH_LOT_TYPES.has(lotTypes[0])) {
    const universalRow = allRows.find(r => norm(r.branch) === 'ALL' && UNIVERSAL_HIGH_LOT_TYPES.has(norm(r.lot_type)));
    return { expectedTier: 'High', era: null, matchedRow: universalRow || null };
  }

  const branchRows = allRows.filter(r => norm(r.branch) === norm(branch));
  const zoneRows = branchRows.filter(r => textMatches(r.zone, zone));
  if (!zoneRows.length) return { expectedTier: null, era: null, matchedRow: null };

  if (suiteNo) {
    const suiteRows = zoneRows.filter(r => r.suite_no && textMatches(r.suite_no, suiteNo));
    const bestSuiteRow = pickMostSpecific(suiteRows, 'suite_no', suiteNo);
    if (bestSuiteRow && bestSuiteRow.intended_tier) {
      return { expectedTier: bestSuiteRow.intended_tier, era: bestSuiteRow.era, matchedRow: bestSuiteRow };
    }
  }

  const zoneWideRows = zoneRows.filter(r => !r.suite_no);
  const bestZoneRow = pickMostSpecific(zoneWideRows, 'zone', zone);
  if (bestZoneRow) return { expectedTier: bestZoneRow.intended_tier, era: bestZoneRow.era, matchedRow: bestZoneRow };
  return { expectedTier: null, era: null, matchedRow: null };
}

// "Aligned" = within 10% of the peer average — consistent with the ±20% price band already
// used for Level Analysis's compensation check elsewhere in this file, just tighter since here
// peers share an owner-confirmed tier rather than merely a similar price.
const PRICE_ALIGNMENT_BAND = 0.10;

function computePriceAlignment(rows) {
  const peerGroups = new Map();
  for (const r of rows) {
    if (!r.expectedTier) continue;
    const key = `${norm(r.branch)}|${norm(r.era)}|${r.expectedTier}`;
    if (!peerGroups.has(key)) peerGroups.set(key, []);
    peerGroups.get(key).push(r);
  }
  for (const r of rows) {
    if (!r.expectedTier) { r.priceAlignment = 'N/A'; continue; }
    const key = `${norm(r.branch)}|${norm(r.era)}|${r.expectedTier}`;
    const peers = peerGroups.get(key).filter(p => p !== r);
    if (!peers.length) { r.priceAlignment = 'N/A'; continue; }
    const peerAvg = peers.reduce((sum, p) => sum + p.actualPrice, 0) / peers.length;
    if (r.actualPrice > peerAvg * (1 + PRICE_ALIGNMENT_BAND)) r.priceAlignment = 'Higher Than Peers';
    else if (r.actualPrice < peerAvg * (1 - PRICE_ALIGNMENT_BAND)) r.priceAlignment = 'Lower Than Peers';
    else r.priceAlignment = 'Aligned';
  }
}

export function getZoneTiers(filters = {}) {
  const suiteRequested = toArray(filters.suiteNo).some(v => String(v ?? '').trim() !== '');
  const { where, params } = buildWhere(filters);
  const selectCols = [`TRIM("Branch") AS branch`, `TRIM("Zone") AS zone`];
  const groupCols = [`TRIM("Branch")`, `TRIM("Zone")`];
  if (suiteRequested) {
    selectCols.push(`TRIM("Suite No") AS suiteNo`);
    groupCols.push(`TRIM("Suite No")`);
  }

  const rows = getDb().prepare(`
    SELECT
      ${selectCols.join(',\n      ')},
      AVG("Unit Price")           AS actualPrice,
      SUM("Total Stock Case")     AS unitCount,
      SUM("Total Sold Case")      AS soldUnits,
      SUM("Total Balance Amount") AS balanceValue
    FROM master_stock
    ${where}
    GROUP BY ${groupCols.join(', ')}
    HAVING SUM("Total Stock Case") >= 50
  `).all(...params);

  const attrRows = getDb().prepare(`SELECT * FROM zone_attributes`).all();
  const lotTypeFilter = toArray(filters.lotType);

  const result = rows.map(r => {
    const { expectedTier, era, matchedRow } = lookupZoneAttribute(attrRows, {
      branch: r.branch, zone: r.zone, suiteNo: r.suiteNo, lotTypeFilter,
    });
    return {
      branch: r.branch,
      zone: r.zone,
      suiteNo: r.suiteNo ?? null,
      unitCount: r.unitCount || 0,
      actualPrice: r.actualPrice || 0,
      sellThroughPct: r.unitCount > 0 ? ((r.soldUnits || 0) / r.unitCount) * 100 : 0,
      balanceValue: r.balanceValue || 0,
      expectedTier,
      era,
      religionType: matchedRow?.religion_type || null,
      matchNotes: matchedRow?.notes || null,
    };
  });

  computePriceAlignment(result);
  return { rows: result };
}

// ── Zone/Suite/Lot-Type Attribute Registry — manual CRUD backing the Product Attributes form ──

export function listZoneAttributes(filters = {}) {
  const b = String(filters.branch || '').trim();
  const pt = String(filters.productType || '').trim();
  const clauses = [];
  const params = [];
  if (b) { clauses.push('UPPER(TRIM(branch)) = ?'); params.push(b.toUpperCase()); }
  if (pt) { clauses.push('UPPER(TRIM(product_type)) = ?'); params.push(pt.toUpperCase()); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT * FROM zone_attributes ${where} ORDER BY branch, product_type, zone, suite_no, lot_type`).all(...params);
  return { rows };
}

function nullableText(v) {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}

export function upsertZoneAttribute(data = {}) {
  const branch = nullableText(data.branch);
  const zone = nullableText(data.zone);
  if (!branch || !zone) throw new Error('branch and zone are required');

  const suiteNo = nullableText(data.suiteNo);
  const lotType = nullableText(data.lotType);
  const productType = nullableText(data.productType);
  const intendedTier = data.intendedTier && VALID_TIERS.has(data.intendedTier) ? data.intendedTier : null;
  const era = nullableText(data.era);
  const religionType = nullableText(data.religionType);
  const walkwayWidth = nullableText(data.walkwayWidth);
  const walkwayProximity = nullableText(data.walkwayProximity);
  const gazeboProximity = nullableText(data.gazeboProximity);
  const elevationTier = nullableText(data.elevationTier);
  const notes = nullableText(data.notes);

  // FAMILY isn't a fixed tier (unlike SUPER FAMILY / ROYAL FAMILY, which are always High) — so
  // this is a soft warning, not a blocked save, when someone sets one to Low anyway.
  const warning = (lotType && norm(lotType) === FAMILY_LOT_TYPE && intendedTier === 'Low')
    ? 'Family lots are typically Mid or High tier only'
    : null;

  const params = [branch, zone, suiteNo, lotType, intendedTier, era, religionType,
    walkwayWidth, walkwayProximity, gazeboProximity, elevationTier, notes, productType];

  if (data.id) {
    getDb().prepare(`
      UPDATE zone_attributes SET
        branch = ?, zone = ?, suite_no = ?, lot_type = ?, intended_tier = ?, era = ?,
        religion_type = ?, walkway_width = ?, walkway_proximity = ?,
        gazebo_proximity = ?, elevation_tier = ?, notes = ?, product_type = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(...params, data.id);
    return { success: true, id: Number(data.id), warning };
  }

  const result = getDb().prepare(`
    INSERT INTO zone_attributes
      (branch, zone, suite_no, lot_type, intended_tier, era, religion_type,
       walkway_width, walkway_proximity, gazebo_proximity, elevation_tier, notes, product_type, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(...params);
  return { success: true, id: result.lastInsertRowid, warning };
}

export function deleteZoneAttribute(id) {
  if (!id) throw new Error('id is required');
  getDb().prepare(`DELETE FROM zone_attributes WHERE id = ?`).run(id);
  return { success: true };
}

// ── Section 2: Level Size & Sell-Through Analysis ──

// Lot Dimension is stored "WIDTHxDEPTH" (e.g. "51x30") — parsed to an area so "larger" has an
// unambiguous meaning. Unparseable/blank dimensions return null and are simply never flagged
// Enlarged (nothing to compare).
function parseDimensionArea(dim) {
  if (!dim) return null;
  const m = String(dim).trim().match(/^([\d.]+)\s*[xX×]\s*([\d.]+)$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const d = parseFloat(m[2]);
  if (!w || !d) return null;
  return w * d;
}

// "Most common" = the dimension with the largest total unit volume (SUM of Total Stock Case)
// in scope, not just the most frequent row — a handful of huge lots shouldn't lose to many
// tiny ones, and this stays consistent with how every other size/volume figure in this route
// is weighted.
function mostCommonDimension(dimUnitPairs) {
  let best = null, bestUnits = -1;
  for (const [dim, units] of dimUnitPairs) {
    if (units > bestUnits) { best = dim; bestUnits = units; }
  }
  return best;
}

export function getLevelAnalysis(filters = {}) {
  const { where, params } = buildWhere(filters);
  const dimClause = `"Lot Dimension" IS NOT NULL AND TRIM("Lot Dimension") != ''`;
  const dimWhere = where ? `${where} AND ${dimClause}` : `WHERE ${dimClause}`;

  const overallDimRows = getDb().prepare(`
    SELECT TRIM("Lot Dimension") AS dim, SUM("Total Stock Case") AS units
    FROM master_stock
    ${dimWhere}
    GROUP BY TRIM("Lot Dimension")
  `).all(...params);
  const standardDimension = mostCommonDimension(overallDimRows.map(r => [r.dim, r.units || 0]));
  const standardArea = parseDimensionArea(standardDimension);

  const levelRows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Level No"), 'Unknown') AS level,
      AVG("Unit Price")           AS avgPrice,
      SUM("Total Stock Case")     AS unitCount,
      SUM("Total Sold Case")      AS soldUnits,
      SUM("Total Balance Amount") AS balanceValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Level No")
  `).all(...params);

  const levelDimRows = getDb().prepare(`
    SELECT COALESCE(TRIM("Level No"), 'Unknown') AS level, TRIM("Lot Dimension") AS dim, SUM("Total Stock Case") AS units
    FROM master_stock
    ${dimWhere}
    GROUP BY TRIM("Level No"), TRIM("Lot Dimension")
  `).all(...params);

  const dimsByLevel = new Map();
  for (const r of levelDimRows) {
    if (!dimsByLevel.has(r.level)) dimsByLevel.set(r.level, []);
    dimsByLevel.get(r.level).push([r.dim, r.units || 0]);
  }

  const levels = levelRows.map(r => {
    const levelDim = mostCommonDimension(dimsByLevel.get(r.level) || []);
    const levelArea = parseDimensionArea(levelDim);
    const sizeCategory = (levelArea !== null && standardArea !== null && levelArea > standardArea) ? 'Enlarged' : 'Standard';
    return {
      level: r.level,
      unitCount: r.unitCount || 0,
      avgPrice: r.avgPrice || 0,
      sellThroughPct: r.unitCount > 0 ? ((r.soldUnits || 0) / r.unitCount) * 100 : 0,
      balanceValue: r.balanceValue || 0,
      mostCommonDimension: levelDim,
      sizeCategory,
    };
  });

  // Compensation check: an Enlarged level's sell-through vs. the average sell-through of
  // Standard levels priced within +/-20% of it. Falls back to comparing against ALL Standard
  // levels (ignoring the price band) if none fall in that band — still a real comparison
  // rather than an unresolvable "N/A" purely because the price-banded peer set happened to be
  // empty.
  const standardLevels = levels.filter(l => l.sizeCategory === 'Standard');
  const result = levels.map(l => {
    if (l.sizeCategory !== 'Enlarged') return { ...l, compensationStatus: 'N/A' };

    let peers = standardLevels.filter(s => s.avgPrice >= l.avgPrice * 0.8 && s.avgPrice <= l.avgPrice * 1.2);
    if (!peers.length) peers = standardLevels;
    if (!peers.length) return { ...l, compensationStatus: 'N/A' };

    const peerAvgSellThrough = peers.reduce((sum, p) => sum + p.sellThroughPct, 0) / peers.length;
    return { ...l, compensationStatus: l.sellThroughPct < peerAvgSellThrough ? 'Insufficient' : 'Sufficient' };
  });

  result.sort((a, b) => naturalLevelCompare(a.level, b.level));
  return { rows: result, standardDimension };
}

// Levels are a mix of plain numbers ("1".."12"), zero-padded numbers ("00","03"), suffixed
// numbers ("3A", "1M") and letters ("G"). Sorts by leading numeric value first (non-numeric
// leads sort last), then by the remaining suffix text — "1" before "1M" before "2".
function naturalLevelCompare(a, b) {
  const parse = (s) => {
    const m = String(s).match(/^(\d+)(.*)$/);
    return m ? { num: parseInt(m[1], 10), rest: m[2] } : { num: Infinity, rest: String(s) };
  };
  const pa = parse(a), pb = parse(b);
  if (pa.num !== pb.num) return pa.num - pb.num;
  return pa.rest.localeCompare(pb.rest);
}

// ── Section 3: Dimension Consistency Check ──

// "Lot Create On" is stored as an integer YYYYMMDD — reshape to YYYY-MM-DD for SQLite's
// date(). Mirrors routes/lifecycle.js.
const LOT_CREATE_DATE_EXPR = `(
  substr(CAST("Lot Create On" AS TEXT), 1, 4) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 5, 2) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 7, 2)
)`;
const VALID_LOT_CREATE = `"Lot Create On" IS NOT NULL AND "Lot Create On" != ''`;

function parseYYYYMMDD(val) {
  const s = String(val ?? '');
  if (s.length < 6) return null;
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10);
  if (!year || !month || month < 1 || month > 12) return null;
  return { year, month };
}
const quarterOf = (month) => Math.floor((month - 1) / 3) + 1;
const cohortPeriodOf = ({ year, month }) => `${year}-Q${quarterOf(month)}`;

export function getDimensionConsistency(filters = {}) {
  const { where, params } = buildWhere(filters, [
    VALID_LOT_CREATE,
    `${LOT_CREATE_DATE_EXPR} >= date('now', '-3 years')`,
    `"Lot Dimension" IS NOT NULL AND TRIM("Lot Dimension") != ''`,
  ]);

  const rows = getDb().prepare(`
    SELECT
      TRIM("Branch")              AS branch,
      TRIM("Material Type Desc.") AS productType,
      TRIM("Lot Type")            AS lotType,
      TRIM("Zone")                AS zone,
      TRIM("Lot Dimension")       AS dimension,
      "Lot Create On"             AS lotCreateOn,
      "Total Stock Case"          AS totalStock,
      "Total Sold Case"           AS totalSold,
      "Total Balance Amount"      AS totalBalanceAmount
    FROM master_stock
    ${where}
  `).all(...params);

  // Group -> Branch+ProductType+LotType+Zone ("the group"), sub-grouped by CohortPeriod. Each
  // cohort period's own dominant dimension (by unit volume) is compared against the group's
  // overall standard dimension (also by unit volume, across every cohort period in the group).
  const groups = new Map();
  for (const r of rows) {
    const created = parseYYYYMMDD(r.lotCreateOn);
    if (!created) continue;
    const cohortPeriod = cohortPeriodOf(created);
    const groupKey = `${r.branch}|${r.productType}|${r.lotType}|${r.zone}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        branch: r.branch, productType: r.productType, lotType: r.lotType, zone: r.zone,
        dimUnits: new Map(), cohorts: new Map(),
      });
    }
    const g = groups.get(groupKey);
    const totalStock = Number(r.totalStock) || 0;
    g.dimUnits.set(r.dimension, (g.dimUnits.get(r.dimension) || 0) + totalStock);

    if (!g.cohorts.has(cohortPeriod)) {
      g.cohorts.set(cohortPeriod, { totalUnits: 0, soldUnits: 0, balanceValue: 0, dimUnits: new Map() });
    }
    const c = g.cohorts.get(cohortPeriod);
    c.totalUnits += totalStock;
    c.soldUnits += Number(r.totalSold) || 0;
    c.balanceValue += Number(r.totalBalanceAmount) || 0;
    c.dimUnits.set(r.dimension, (c.dimUnits.get(r.dimension) || 0) + totalStock);
  }

  const result = [];
  for (const g of groups.values()) {
    const standardDimension = mostCommonDimension([...g.dimUnits.entries()]);
    for (const [cohortPeriod, c] of g.cohorts) {
      const actualDimension = mostCommonDimension([...c.dimUnits.entries()]);
      if (actualDimension === standardDimension) continue;
      result.push({
        branch: g.branch,
        productType: g.productType,
        lotType: g.lotType,
        zone: g.zone,
        cohortPeriod,
        standardDimension,
        actualDimension,
        unitCount: c.totalUnits,
        sellThroughPct: c.totalUnits > 0 ? (c.soldUnits / c.totalUnits) * 100 : 0,
        balanceValue: c.balanceValue,
      });
    }
  }

  result.sort((a, b) => b.balanceValue - a.balanceValue);
  return { rows: result };
}

// ── Section 4: Positional Signals (Beta) — Wide Walkway / Gazebo-Center Proximity ──
// Candidates are populated by scripts/detect_plot_signals.js, inferred from lot-numbering and
// dimension patterns rather than directly measured. This module only reads/updates review
// state; it never re-runs detection.

const VALID_SIGNAL_TYPES = new Set(['Wide Walkway', 'Gazebo/Center Proximity']);
const VALID_REVIEW_STATUSES = new Set(['Pending', 'Confirmed', 'Rejected']);

function plotSignalScopeClause(filters) {
  const clauses = [];
  const params = [];
  const branch = toArray(filters.branch).map(v => String(v).trim().toUpperCase()).filter(Boolean);
  if (branch.length) {
    clauses.push(`UPPER(TRIM(branch)) IN (${branch.map(() => '?').join(', ')})`);
    params.push(...branch);
  }
  const zone = toArray(filters.zone).map(v => String(v).trim().toUpperCase()).filter(Boolean);
  if (zone.length) {
    clauses.push(`UPPER(TRIM(zone)) IN (${zone.map(() => '?').join(', ')})`);
    params.push(...zone);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

// Summary cards reflect the Branch/Zone scope only — not the Signal Type / Review Status
// filters — so the cards stay stable reference points (e.g. "how many Pending overall") while
// the table itself narrows with those two filters. Matches the status-flag-card pattern used
// in the Product Lifecycle tab.
export function listPlotSignals(filters = {}) {
  const { where: scopeWhere, params: scopeParams } = plotSignalScopeClause(filters);

  const scopedRows = getDb().prepare(`SELECT signal_type, review_status FROM plot_position_signals ${scopeWhere}`).all(...scopeParams);
  const summary = {
    byReviewStatus: { Pending: 0, Confirmed: 0, Rejected: 0 },
    bySignalType: {},
  };
  for (const r of scopedRows) {
    if (summary.byReviewStatus[r.review_status] !== undefined) summary.byReviewStatus[r.review_status]++;
    summary.bySignalType[r.signal_type] = (summary.bySignalType[r.signal_type] || 0) + 1;
  }

  const clauses = scopeWhere ? [scopeWhere.slice(6)] : [];
  const params = [...scopeParams];
  if (filters.signalType && VALID_SIGNAL_TYPES.has(filters.signalType)) {
    clauses.push(`signal_type = ?`);
    params.push(filters.signalType);
  }
  if (filters.reviewStatus && VALID_REVIEW_STATUSES.has(filters.reviewStatus)) {
    clauses.push(`review_status = ?`);
    params.push(filters.reviewStatus);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb().prepare(`
    SELECT * FROM plot_position_signals ${where}
    ORDER BY branch, zone, row, lot_number, id
  `).all(...params);

  return { rows, summary };
}

export function reviewPlotSignal(data = {}) {
  if (!data.id) throw new Error('id is required');
  if (!VALID_REVIEW_STATUSES.has(data.reviewStatus) || data.reviewStatus === 'Pending') {
    throw new Error('reviewStatus must be Confirmed or Rejected');
  }
  const notes = data.notes != null ? String(data.notes).trim() || null : undefined;
  const result = getDb().prepare(`
    UPDATE plot_position_signals
    SET review_status = ?, reviewed_at = datetime('now')${notes !== undefined ? ', notes = ?' : ''}
    WHERE id = ?
  `).run(...(notes !== undefined ? [data.reviewStatus, notes, data.id] : [data.reviewStatus, data.id]));
  if (!result.changes) throw new Error('Signal not found');
  return { success: true };
}

// Gazebo/Center Proximity evidence always embeds its gap boundary as "{before}→{after}" — in
// both the step-pattern form ("Gap 398→608: ...") and the fallback-heuristic form ("Adjacent to
// lot-number gap: 398→608 (...)") — so this single regex covers both. Many candidates across
// different Branch/Zone/Row groups share the exact same boundary (the same physical row
// template, and often the same underlying step/suffix convention, reused across zones), which
// is what makes pattern-grouped bulk review worthwhile. Wide Walkway evidence never matches —
// those always review individually. Shared between listPlotSignals (client groups by this on
// its own) and reviewPlotSignalsByPattern (server must match it exactly the same way).
export function extractGapPattern(evidence) {
  const m = String(evidence || '').match(/(\d+)→(\d+)/);
  return m ? `${m[1]}→${m[2]}` : null;
}

export function reviewPlotSignalsByPattern(data = {}) {
  const patternKey = String(data.patternKey || '').trim();
  if (!patternKey) throw new Error('patternKey is required');
  if (!VALID_REVIEW_STATUSES.has(data.reviewStatus) || data.reviewStatus === 'Pending') {
    throw new Error('reviewStatus must be Confirmed or Rejected');
  }
  const notes = data.notes != null ? String(data.notes).trim() || null : undefined;

  // Only Pending rows are bulk-updated — a pattern group may contain rows already
  // Confirmed/Rejected individually, and those shouldn't be silently overwritten by a bulk
  // action taken later on the same recurring pattern.
  const pendingRows = getDb().prepare(`
    SELECT id, evidence FROM plot_position_signals
    WHERE signal_type = 'Gazebo/Center Proximity' AND review_status = 'Pending'
  `).all();
  const matchingIds = pendingRows.filter(r => extractGapPattern(r.evidence) === patternKey).map(r => r.id);
  if (!matchingIds.length) return { success: true, updatedCount: 0 };

  const update = getDb().prepare(`
    UPDATE plot_position_signals
    SET review_status = ?, reviewed_at = datetime('now')${notes !== undefined ? ', notes = ?' : ''}
    WHERE id = ?
  `);
  const updateMany = getDb().transaction((ids) => {
    for (const id of ids) {
      update.run(...(notes !== undefined ? [data.reviewStatus, notes, id] : [data.reviewStatus, id]));
    }
  });
  updateMany(matchingIds);
  return { success: true, updatedCount: matchingIds.length };
}

const router = Router();

router.post('/zone-tiers', (req, res) => {
  try {
    res.json(getZoneTiers(req.body || {}));
  } catch (err) {
    console.error('Attributes zone-tiers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/zone-attributes', (req, res) => {
  try {
    res.json(listZoneAttributes(req.query || {}));
  } catch (err) {
    console.error('Attributes zone-attributes list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/zone-attributes', (req, res) => {
  try {
    res.json(upsertZoneAttribute(req.body || {}));
  } catch (err) {
    console.error('Attributes zone-attributes upsert error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/zone-attributes/:id', (req, res) => {
  try {
    res.json(deleteZoneAttribute(req.params.id));
  } catch (err) {
    console.error('Attributes zone-attributes delete error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/level-analysis', (req, res) => {
  try {
    res.json(getLevelAnalysis(req.body || {}));
  } catch (err) {
    console.error('Attributes level-analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/dimension-consistency', (req, res) => {
  try {
    res.json(getDimensionConsistency(req.body || {}));
  } catch (err) {
    console.error('Attributes dimension-consistency error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/plot-signals', (req, res) => {
  try {
    res.json(listPlotSignals(req.body || {}));
  } catch (err) {
    console.error('Attributes plot-signals error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/plot-signals/review', (req, res) => {
  try {
    res.json(reviewPlotSignal(req.body || {}));
  } catch (err) {
    console.error('Attributes plot-signals review error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/plot-signals/review-pattern', (req, res) => {
  try {
    res.json(reviewPlotSignalsByPattern(req.body || {}));
  } catch (err) {
    console.error('Attributes plot-signals review-pattern error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
