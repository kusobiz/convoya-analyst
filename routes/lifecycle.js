import { Router } from 'express';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');

let db = null;
function getDb() {
  if (!db) db = new Database(DB_PATH, { readonly: true });
  return db;
}

function toArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

// Display-only: the DB's "Material Type Desc." values are all prefixed "NV ".
function stripNVPrefix(materialType) {
  return String(materialType || '').replace(/^NV\s+/i, '');
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
  suiteNo:     'Suite No',
};

// Every filter accepts either a single value or an array — empty/missing means "All" (no
// filter). extraClauses are literal SQL fragments (already-validated/coerced values only,
// never raw user strings) appended alongside the FILTER_COLUMNS-derived ones.
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

function distinctColumn(col, whereSql, params) {
  const notEmpty = `"${col}" IS NOT NULL AND TRIM("${col}") != ''`;
  const clause = whereSql ? `${whereSql} AND ${notEmpty}` : `WHERE ${notEmpty}`;
  return getDb().prepare(`
    SELECT DISTINCT TRIM("${col}") AS val FROM master_stock ${clause} ORDER BY val
  `).all(...params).map(r => r.val);
}

// "Lot Create On" is stored as an integer YYYYMMDD (e.g. 20181118) — reshape to YYYY-MM-DD so
// SQLite's date()/julianday() can parse it. Mirrors routes/pricing.js and routes/lots.js.
const LOT_CREATE_DATE_EXPR = `(
  substr(CAST("Lot Create On" AS TEXT), 1, 4) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 5, 2) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 7, 2)
)`;
const VALID_LOT_CREATE = `"Lot Create On" IS NOT NULL AND "Lot Create On" != ''`;

const ONE_OF_AGE_MONTHS = new Set([1, 3, 6, 12]);
function resolveAgeMonths(ageMonths) {
  const n = Number(ageMonths);
  return ONE_OF_AGE_MONTHS.has(n) ? n : 6;
}

export function getLifecycleFilters(filters = {}) {
  const { branch, bigLotFilter } = filters;

  const { where: branchWhere, params: branchParams } = buildWhere({ bigLotFilter });
  const branches = distinctColumn('Branch', branchWhere, branchParams);

  const { where: productWhere, params: productParams } = buildWhere({ branch, bigLotFilter });
  const productTypes = distinctColumn('Material Type Desc.', productWhere, productParams);

  return { branches, productTypes };
}

// ── New vs Aging Overview ──
// "New" = any status, Lot Create On within the last ageMonths. "Aging" burden (agingUnits /
// agingBalanceValue) = specifically the still-unsold OPEN remainder of cohorts older than
// ageMonths. agingSellThroughPct is deliberately computed over ALL of those older cohorts
// (every status, not just the OPEN rows) — it's the cohort's own historical performance-so-far,
// context for why the OPEN remainder (the burden) is what it is; the OPEN subset by itself
// would always show 0% sold, which isn't a useful "sell-through" figure.
export function getLifecycleOverview(filters = {}) {
  const ageMonths = resolveAgeMonths(filters.ageMonths);

  const { where: newWhere, params: newParams } = buildWhere(filters, [
    VALID_LOT_CREATE,
    `${LOT_CREATE_DATE_EXPR} >= date('now', '-${ageMonths} months')`,
  ]);
  const newRow = getDb().prepare(`
    SELECT
      SUM("Total Stock Case")     AS totalUnits,
      SUM("Total Sold Case")      AS soldUnits,
      SUM("Total Balance Amount") AS balanceValue
    FROM master_stock
    ${newWhere}
  `).get(...newParams);

  const { where: agingCohortWhere, params: agingCohortParams } = buildWhere(filters, [
    VALID_LOT_CREATE,
    `${LOT_CREATE_DATE_EXPR} < date('now', '-${ageMonths} months')`,
  ]);
  const agingCohortRow = getDb().prepare(`
    SELECT
      SUM("Total Stock Case") AS totalUnits,
      SUM("Total Sold Case")  AS soldUnits
    FROM master_stock
    ${agingCohortWhere}
  `).get(...agingCohortParams);

  const { where: agingOpenWhere, params: agingOpenParams } = buildWhere(filters, [
    VALID_LOT_CREATE,
    `${LOT_CREATE_DATE_EXPR} < date('now', '-${ageMonths} months')`,
    `UPPER(TRIM("Status")) = 'OPEN'`,
  ]);
  const agingOpenRow = getDb().prepare(`
    SELECT
      SUM("Total Balance Case")   AS balanceUnits,
      SUM("Total Balance Amount") AS balanceValue
    FROM master_stock
    ${agingOpenWhere}
  `).get(...agingOpenParams);

  const { where: totalWhere, params: totalParams } = buildWhere(filters);
  const totalRow = getDb().prepare(`
    SELECT SUM("Total Balance Amount") AS totalBalanceValue FROM master_stock ${totalWhere}
  `).get(...totalParams);

  const newUnits = newRow.totalUnits || 0;
  const newSellThroughPct = newUnits > 0 ? ((newRow.soldUnits || 0) / newUnits) * 100 : 0;

  const agingCohortUnits = agingCohortRow.totalUnits || 0;
  const agingSellThroughPct = agingCohortUnits > 0 ? ((agingCohortRow.soldUnits || 0) / agingCohortUnits) * 100 : 0;

  const agingUnits = agingOpenRow.balanceUnits || 0;
  const agingBalanceValue = agingOpenRow.balanceValue || 0;
  const totalBalanceValue = totalRow.totalBalanceValue || 0;
  const pctOfTotalBalanceThatIsAging = totalBalanceValue > 0 ? (agingBalanceValue / totalBalanceValue) * 100 : 0;

  return {
    ageMonths,
    newUnits,
    newBalanceValue: newRow.balanceValue || 0,
    newSellThroughPct,
    agingUnits,
    agingBalanceValue,
    agingSellThroughPct,
    totalBalanceValue,
    pctOfTotalBalanceThatIsAging,
  };
}

// Suite No is meaningfully populated (>50%) for only a couple of structured product types —
// verified against actual data: NV Baby Paradise 100%, NV Niche 68.3%, vs. NV Pedestal 32.2%
// and NV Pet Niche 19.3% (kept Zone-only) and everything else ~0%. Those two get Suite No
// promoted into the cohort key itself (Branch+ProductType+Zone+SuiteNo+CohortPeriod) — see
// buildCohortsFromRows — rather than only reachable one drill-down step down.
const SUITE_GROUPED_TYPES = ['NV Niche', 'NV Baby Paradise'];
function isSuiteGrouped(productType) {
  return SUITE_GROUPED_TYPES.includes(productType);
}

// ── Cohort grouping (shared by /curve and /cohort-table) ──
function fetchLifecycleRows(filters) {
  const { where, params } = buildWhere(filters, [VALID_LOT_CREATE]);
  return getDb().prepare(`
    SELECT
      TRIM("Branch")              AS branch,
      TRIM("Material Type Desc.") AS productType,
      TRIM("Zone")                AS zone,
      TRIM("Suite No")            AS suiteNo,
      "Lot Create On"             AS lotCreateOn,
      "Sales Date"                AS salesDate,
      "Total Stock Case"          AS totalStock,
      "Total Sold Case"           AS totalSold,
      "Total Balance Case"        AS totalBalance,
      "Total Balance Amount"      AS totalBalanceAmount,
      "Unit Price"                AS unitPrice
    FROM master_stock
    ${where}
  `).all(...params);
}

function parseYYYYMMDD(val) {
  const s = String(val ?? '');
  if (s.length < 6) return null;
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10);
  if (!year || !month || month < 1 || month > 12) return null;
  return { year, month };
}

const quarterOf = (month) => Math.floor((month - 1) / 3) + 1;
const monthIndexOf = ({ year, month }) => year * 12 + month;
const cohortPeriodOf = ({ year, month }) => `${year}-Q${quarterOf(month)}`;

// CohortPeriod ("2024-Q2") -> the month index of that quarter's first month — used as the
// cohort-level "launch" reference for ageMonthsNow, since individual lots within one quarter
// can have Lot Create On dates spread across ~3 different months.
function cohortPeriodStartMonthIndex(cohortPeriod) {
  const [yearStr, qStr] = cohortPeriod.split('-Q');
  const year = Number(yearStr);
  const quarter = Number(qStr);
  return year * 12 + ((quarter - 1) * 3 + 1);
}

function nowMonthIndex() {
  const now = new Date();
  return now.getFullYear() * 12 + (now.getMonth() + 1);
}

// Groups raw rows into cohorts, keyed Branch+ProductType+Zone+CohortPeriod (or
// Branch+ProductType+Zone+SuiteNo+CohortPeriod for SUITE_GROUPED_TYPES — see isSuiteGrouped).
// Zone is the primary cohort unit — a single zone (or zone+suite) launch is one cohort
// regardless of how many levels it spans (Level is always a drill-down detail, see
// getLifecycleLevelBreakdown, never a top-level grouping key). Zone exists for flat-land
// product types too (unlike Level, which is blank there), so this grouping works uniformly
// across structured and flat-land types. Per
// spec: totalUnits/soldUnits/balanceUnits/balanceValue/avgPrice are summed/averaged across every
// row in the cohort regardless of status; soldByMonth (the cumulative-sell-through curve's
// raw material) only counts rows with a real sale (Total Sold Case > 0 — unsold OPEN lots
// carry a placeholder Sales Date equal to Lot Create On and are always excluded here),
// bucketed by that lot's own monthsSinceLaunch = its Sales Date month index minus its own
// Lot Create On month index.
function buildCohortsFromRows(rows) {
  const cohorts = new Map();
  for (const r of rows) {
    const created = parseYYYYMMDD(r.lotCreateOn);
    if (!created) continue;
    const cohortPeriod = cohortPeriodOf(created);
    const suiteGrouped = isSuiteGrouped(r.productType);
    // Rows with no Suite No (even for a suite-grouped product type — Niche is only 68.3%
    // populated) fall into their own zone-level "no suite data" bucket (suiteNo: null) rather
    // than being dropped, so nothing silently disappears from the table.
    const suiteNo = suiteGrouped && r.suiteNo ? r.suiteNo : null;
    const key = suiteGrouped
      ? `${r.branch}|${r.productType}|${r.zone}|${suiteNo}|${cohortPeriod}`
      : `${r.branch}|${r.productType}|${r.zone}|${cohortPeriod}`;
    if (!cohorts.has(key)) {
      cohorts.set(key, {
        branch: r.branch, productType: r.productType, zone: r.zone,
        suiteNo: suiteGrouped ? suiteNo : null, cohortPeriod,
        totalUnits: 0, soldUnits: 0, balanceUnits: 0, balanceValue: 0,
        priceSum: 0, priceCount: 0,
        soldByMonth: new Map(),
      });
    }
    const c = cohorts.get(key);
    const totalStock = Number(r.totalStock) || 0;
    const totalSold = Number(r.totalSold) || 0;
    const unitPrice = Number(r.unitPrice) || 0;

    c.totalUnits += totalStock;
    c.soldUnits += totalSold;
    c.balanceUnits += Number(r.totalBalance) || 0;
    c.balanceValue += Number(r.totalBalanceAmount) || 0;
    if (unitPrice > 0) { c.priceSum += unitPrice; c.priceCount += 1; }

    if (totalSold > 0) {
      const sold = parseYYYYMMDD(r.salesDate);
      if (sold) {
        const m = monthIndexOf(sold) - monthIndexOf(created);
        if (m >= 0) c.soldByMonth.set(m, (c.soldByMonth.get(m) || 0) + totalSold);
      }
    }
  }

  const nowMI = nowMonthIndex();
  const list = [];
  for (const c of cohorts.values()) {
    const ageMonthsNow = Math.max(0, nowMI - cohortPeriodStartMonthIndex(c.cohortPeriod));
    list.push({
      ...c,
      ageMonthsNow,
      avgPrice: c.priceCount > 0 ? c.priceSum / c.priceCount : 0,
      overallSellThroughPct: c.totalUnits > 0 ? (c.soldUnits / c.totalUnits) * 100 : 0,
      cohortLabel: `${c.branch} - ${stripNVPrefix(c.productType)} - Zone ${c.zone}`
        + (c.suiteNo !== null ? ` - Suite ${c.suiteNo}` : isSuiteGrouped(c.productType) ? ' - No Suite Data' : '')
        + ` - ${c.cohortPeriod}`,
    });
  }
  return list;
}

function cumulativeSoldAt(cohort, m) {
  if (m < 0) return 0;
  let sum = 0;
  for (const [month, sold] of cohort.soldByMonth) {
    if (month <= m) sum += sold;
  }
  return sum;
}
function cumulativePctAt(cohort, m) {
  return cohort.totalUnits > 0 ? (cumulativeSoldAt(cohort, m) / cohort.totalUnits) * 100 : 0;
}

export function getLifecycleCurve(filters = {}) {
  const maxCohorts = Number(filters.maxCohorts) > 0 ? Number(filters.maxCohorts) : 8;
  const cohorts = buildCohortsFromRows(fetchLifecycleRows(filters));

  // Largest cohorts by unit count first, so the chart doesn't get overcrowded.
  cohorts.sort((a, b) => b.totalUnits - a.totalUnits);

  const result = cohorts.slice(0, maxCohorts).map(c => {
    const maxMonth = Math.min(36, c.ageMonthsNow);
    const points = [];
    let cumulative = 0;
    for (let m = 0; m <= maxMonth; m++) {
      cumulative += c.soldByMonth.get(m) || 0;
      points.push({
        monthsSinceLaunch: m,
        cumulativeSellThroughPct: c.totalUnits > 0 ? (cumulative / c.totalUnits) * 100 : 0,
      });
    }
    return {
      cohortLabel: c.cohortLabel, branch: c.branch, productType: c.productType, zone: c.zone,
      suiteNo: c.suiteNo, cohortPeriod: c.cohortPeriod, totalUnits: c.totalUnits,
      ageMonthsNow: c.ageMonthsNow, points,
    };
  });

  return { cohorts: result };
}

// If a cohort is younger than the selected ageMonths threshold it's simply "New" — too early
// to judge velocity. Otherwise compares its early momentum (month 0->3) against its recent
// momentum (its last 3 months) to flag whether it's kept selling at pace, slowed, or stalled.
function cohortStatusFlag(cohort, ageMonths) {
  if (cohort.ageMonthsNow < ageMonths) return 'New';
  if (cohort.balanceUnits === 0) return 'Sold Out';

  const earlyVelocity = cumulativePctAt(cohort, Math.min(3, cohort.ageMonthsNow)) - cumulativePctAt(cohort, 0);
  const recentVelocity = cumulativePctAt(cohort, cohort.ageMonthsNow) - cumulativePctAt(cohort, Math.max(0, cohort.ageMonthsNow - 3));

  // A cohort with zero early momentum (never sold anything in its first ~3 months) can't be
  // judged by the ratio test below — "recentVelocity < 0" never fires, which would otherwise
  // default a cohort that has NEVER sold a single unit to "Steady". Judge it on whether it's
  // moving at all right now instead: no recent sales either is Stagnant; any recent sales despite
  // a slow start is the best case available, so it reads as Steady rather than Slowing.
  if (earlyVelocity <= 0) return recentVelocity > 0 ? 'Steady' : 'Stagnant';

  if (recentVelocity < earlyVelocity * 0.3) return 'Stagnant';
  if (recentVelocity < earlyVelocity * 0.7) return 'Slowing';
  return 'Steady';
}

const STATUS_FLAGS = ['New', 'Steady', 'Slowing', 'Stagnant', 'Sold Out'];
const PEER_COMPARISONS = ['Above Peers', 'On Par', 'Below Peers', 'Insufficient Data'];

// "Price Range" tiers are calibrated per product type, not one universal price scale (e.g.
// Niche's bands are <30k/≥30k/≥50k while Burial Plot's are <100k/≥100k/≥200k/≥500k) — this
// derives each product type's actual band boundaries from the observed MIN Unit Price per
// label already present in the data, the same "Price Range" column Pricing Intelligence uses,
// rather than inventing a fresh boundary scheme. Product types that carry no price bands at
// all (Price Range = 'false' for every row — Baby Paradise, EBL, Pet Burial Plot, Pet Niche,
// Seed, per routes/pricing.js's REAL_PRICE_RANGE comment) simply have no entry here.
function getPriceRangeBandsByProductType() {
  const rows = getDb().prepare(`
    SELECT
      TRIM("Material Type Desc.") AS productType,
      TRIM("Price Range")         AS priceRange,
      MIN("Unit Price")           AS minPrice
    FROM master_stock
    WHERE "Price Range" IS NOT NULL AND TRIM("Price Range") != '' AND TRIM("Price Range") != 'false'
      AND "Unit Price" IS NOT NULL AND "Unit Price" > 0
    GROUP BY TRIM("Material Type Desc."), TRIM("Price Range")
  `).all();

  const byType = new Map();
  for (const r of rows) {
    if (!byType.has(r.productType)) byType.set(r.productType, []);
    byType.get(r.productType).push({ label: r.priceRange, minPrice: r.minPrice });
  }
  for (const bands of byType.values()) bands.sort((a, b) => a.minPrice - b.minPrice);
  return byType;
}

// Classifies a cohort's avgPrice into its product type's Price Range tier (the band whose
// minPrice is the largest one <= avgPrice). Product types with no bands at all fall back to a
// single shared 'N/A' tier, so their peer comparison still degrades gracefully to "same product
// type" instead of finding zero peers.
function priceRangeTierFor(productType, avgPrice, bandsByType) {
  const bands = bandsByType.get(productType);
  if (!bands || !bands.length) return 'N/A';
  let tier = bands[0].label;
  for (const b of bands) {
    if (avgPrice >= b.minPrice) tier = b.label;
    else break;
  }
  return tier;
}

// The Cohort Table has its own decoupled Branch/Product Type filters (cohortFiltersUI in the
// frontend) — separate from the tab-wide Branch/Product Type filters that drive Overview/Curve/
// New Zones/Agent Focus, same "own independent filters" pattern routes/pricing.js's Pivot
// Builder already uses (pivotFiltersUI). Level is deliberately not one of them: Level is a
// per-row drill-down detail (getLifecycleLevelBreakdown), never a Cohort Table filter dimension.
export function getLifecycleCohortTable(filters = {}) {
  const ageMonths = resolveAgeMonths(filters.ageMonths);
  const { branch, productType, bigLotFilter } = filters;
  const cohorts = buildCohortsFromRows(fetchLifecycleRows({ branch, productType, bigLotFilter }));

  // Peer Benchmark (item 3) always compares against the full, branch-unscoped set of cohorts
  // sharing the same Product Type + Price Range tier — a genuine historical benchmark, not
  // narrowed by whichever Branch the Cohort Table's own filters currently show. Product Type
  // and bigLotFilter are still honored (no reason to pull types the user has excluded, and
  // bigLotFilter is a real "exclude these lots from analysis" setting, not a display scope).
  const peerUniverse = buildCohortsFromRows(fetchLifecycleRows({ productType, bigLotFilter }));
  const priceRangeBands = getPriceRangeBandsByProductType();
  const peerGroups = new Map();
  for (const c of peerUniverse) {
    const tier = priceRangeTierFor(c.productType, c.avgPrice, priceRangeBands);
    const key = `${c.productType}|${tier}`;
    if (!peerGroups.has(key)) peerGroups.set(key, []);
    peerGroups.get(key).push(c);
  }

  // Peer group = same Product Type + Price Range tier, excluding the cohort itself (matched by
  // its own natural key — `cohorts` and `peerUniverse` come from separate fetches, so this is
  // never the same object even for the identical real-world cohort) and only including peers
  // old enough to have reached this cohort's own ageMonthsNow checkpoint. Below 3 qualifying
  // peers, the comparison is "Insufficient Data" rather than a benchmark computed from a
  // statistically meaningless handful of cohorts.
  function computePeerComparison(c) {
    const tier = priceRangeTierFor(c.productType, c.avgPrice, priceRangeBands);
    const group = peerGroups.get(`${c.productType}|${tier}`) || [];
    const peers = group.filter(p =>
      p.ageMonthsNow >= c.ageMonthsNow &&
      !(p.branch === c.branch && p.zone === c.zone && p.suiteNo === c.suiteNo && p.cohortPeriod === c.cohortPeriod));

    if (peers.length < 3) return { priceRangeTier: tier, peerBenchmarkPct: null, peerComparison: 'Insufficient Data' };

    const peerBenchmarkPct = peers.reduce((sum, p) => sum + cumulativePctAt(p, c.ageMonthsNow), 0) / peers.length;
    const ownPct = cumulativePctAt(c, c.ageMonthsNow);
    const delta = ownPct - peerBenchmarkPct;
    const peerComparison = delta > 10 ? 'Above Peers' : delta < -10 ? 'Below Peers' : 'On Par';
    return { priceRangeTier: tier, peerBenchmarkPct, peerComparison };
  }

  const allRows = cohorts.map(c => ({
    branch: c.branch,
    productType: c.productType,
    zone: c.zone,
    suiteNo: c.suiteNo,
    suiteGrouped: isSuiteGrouped(c.productType),
    cohortPeriod: c.cohortPeriod,
    cohortLabel: c.cohortLabel,
    ageMonthsNow: c.ageMonthsNow,
    totalUnits: c.totalUnits,
    soldUnits: c.soldUnits,
    balanceUnits: c.balanceUnits,
    balanceValue: c.balanceValue,
    avgPrice: c.avgPrice,
    overallSellThroughPct: c.overallSellThroughPct,
    statusFlag: cohortStatusFlag(c, ageMonths),
    ...computePeerComparison(c),
  }));

  // Both summaries are computed BEFORE their own filter dimension (over whatever the OTHER
  // filters have already narrowed to), so every card always shows a real count/value regardless
  // of which value (if any) of ITS OWN dimension is currently selected — clicking a card narrows
  // `rows`, never the cards. Peer Comparison summary respects the Status Flag filter (computed
  // from `afterStatusFlag`, not `allRows`) so the two summary rows read as a consistent pair.
  const statusFlagSummary = STATUS_FLAGS.map(flag => {
    const matching = allRows.filter(r => r.statusFlag === flag);
    return {
      flag,
      count: matching.length,
      balanceValue: matching.reduce((sum, r) => sum + r.balanceValue, 0),
    };
  });

  const statusFlagList = toArray(filters.statusFlag).map(v => String(v).trim()).filter(Boolean);
  const afterStatusFlag = statusFlagList.length ? allRows.filter(r => statusFlagList.includes(r.statusFlag)) : allRows;

  const peerComparisonSummary = PEER_COMPARISONS.map(pc => {
    const matching = afterStatusFlag.filter(r => r.peerComparison === pc);
    return {
      peerComparison: pc,
      count: matching.length,
      balanceValue: matching.reduce((sum, r) => sum + r.balanceValue, 0),
    };
  });

  const peerComparisonList = toArray(filters.peerComparison).map(v => String(v).trim()).filter(Boolean);
  const rows = peerComparisonList.length ? afterStatusFlag.filter(r => peerComparisonList.includes(r.peerComparison)) : afterStatusFlag;

  rows.sort((a, b) => b.balanceValue - a.balanceValue);
  return { rows, ageMonths, statusFlagSummary, peerComparisonSummary };
}

// Parses "YYYY-Qn" (CohortPeriod) into a [start, end) date range on Lot Create On. Mirrors
// routes/lots.js's identically-named helper — kept as a local copy (same convention as
// LOT_CREATE_DATE_EXPR/VALID_LOT_CREATE above) rather than a cross-file import.
function cohortPeriodDateRange(cohortPeriod) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(cohortPeriod || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const startMonth = (Number(m[2]) - 1) * 3 + 1;
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const endYear = startMonth + 3 > 12 ? year + 1 : year;
  const endMonth = ((startMonth + 3 - 1) % 12) + 1;
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
  return { start, end };
}

// Suite Breakdown — the "+" expand on a Cohort Table row, for the remaining structured types
// whose Suite No is populated often enough to be a useful drill-down but not enough to promote
// into the cohort key itself (NV Pedestal 32.2%, NV Pet Niche 19.3% — see SUITE_GROUPED_TYPES
// for the >50% types that skip this step entirely and go straight to Level Breakdown). Scoped
// to one row's own exact Branch+ProductType+Zone+CohortPeriod, same grain the row's own View
// Lots drills into. Rows with no Suite No (blank/NULL) are excluded rather than bucketed into
// 'Unknown' — a given zone-cohort can still have zero populated Suite No rows even though the
// product type as a whole has some; the frontend falls back to a whole-zone Level Breakdown
// when this comes back empty.
export function getLifecycleSuiteBreakdown(filters = {}) {
  const { branch, productType, zone, cohortPeriod } = filters;
  const extra = [VALID_LOT_CREATE, `"Suite No" IS NOT NULL AND TRIM("Suite No") != ''`];
  const cohortRange = cohortPeriod ? cohortPeriodDateRange(cohortPeriod) : null;
  if (cohortRange) {
    extra.push(`${LOT_CREATE_DATE_EXPR} >= '${cohortRange.start}' AND ${LOT_CREATE_DATE_EXPR} < '${cohortRange.end}'`);
  }
  const { where, params } = buildWhere({ branch, productType, zone, bigLotFilter: filters.bigLotFilter }, extra);

  const rows = getDb().prepare(`
    SELECT
      TRIM("Suite No")            AS suiteNo,
      SUM("Total Stock Case")     AS totalUnits,
      SUM("Total Sold Case")      AS soldUnits,
      SUM("Total Balance Case")   AS balanceUnits,
      SUM("Total Balance Amount") AS balanceValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Suite No")
  `).all(...params);

  const result = rows.map(r => ({
    suiteNo: r.suiteNo,
    totalUnits: r.totalUnits || 0,
    balanceUnits: r.balanceUnits || 0,
    balanceValue: r.balanceValue || 0,
    sellThroughPct: r.totalUnits > 0 ? ((r.soldUnits || 0) / r.totalUnits) * 100 : 0,
  })).sort((a, b) => b.balanceValue - a.balanceValue);

  return { rows: result };
}

// Level Breakdown — reached directly from a Cohort Table row's "+" for SUITE_GROUPED_TYPES
// (scoped to that exact Zone+Suite already baked into the cohort) and for EBL/flat-suite-less
// zone-cohorts (unscoped, whole zone); nested one level deeper for the remaining structured
// types via a Suite Breakdown row. Scoped to the row's own exact Branch+ProductType+Zone+
// CohortPeriod, optionally narrowed further to a single Suite No.
export function getLifecycleLevelBreakdown(filters = {}) {
  const { branch, productType, zone, suiteNo, cohortPeriod } = filters;
  const extra = [VALID_LOT_CREATE];
  const cohortRange = cohortPeriod ? cohortPeriodDateRange(cohortPeriod) : null;
  if (cohortRange) {
    extra.push(`${LOT_CREATE_DATE_EXPR} >= '${cohortRange.start}' AND ${LOT_CREATE_DATE_EXPR} < '${cohortRange.end}'`);
  }
  // A single empty-string suiteNo means "the lots with no Suite No at all" — the leftover
  // bucket for a SUITE_GROUPED_TYPES cohort whose Suite No wasn't populated (see
  // buildCohortsFromRows). buildWhere's normal IN-clause can't express "blank" (its FILTER_
  // COLUMNS convention treats an empty value as "no filter", not "filter for blank"), so this
  // is special-cased into its own SQL fragment instead of being routed through FILTER_COLUMNS.
  const suiteList = toArray(suiteNo);
  const wantsBlankSuite = suiteList.length === 1 && suiteList[0] === '';
  if (wantsBlankSuite) extra.push(`("Suite No" IS NULL OR TRIM("Suite No") = '')`);
  const { where, params } = buildWhere(
    { branch, productType, zone, suiteNo: wantsBlankSuite ? undefined : suiteNo, bigLotFilter: filters.bigLotFilter },
    extra,
  );

  const rows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Level No"), 'Unknown') AS level,
      SUM("Total Stock Case")     AS totalUnits,
      SUM("Total Sold Case")      AS soldUnits,
      SUM("Total Balance Case")   AS balanceUnits,
      SUM("Total Balance Amount") AS balanceValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Level No")
  `).all(...params);

  const result = rows.map(r => ({
    level: r.level,
    totalUnits: r.totalUnits || 0,
    balanceUnits: r.balanceUnits || 0,
    balanceValue: r.balanceValue || 0,
    sellThroughPct: r.totalUnits > 0 ? ((r.soldUnits || 0) / r.totalUnits) * 100 : 0,
  })).sort((a, b) => b.balanceValue - a.balanceValue);

  return { rows: result };
}

// Newly Launched Zones — one row per Branch+ProductType+Zone whose EARLIEST Lot Create On
// (across every lot ever recorded in that zone) falls within the last ageMonths, i.e. the zone
// itself is a recent launch, not just a few individual lots trickling in. Since ageMonths is
// tested against the MIN Lot Create On of the group, every other lot in a qualifying zone is
// necessarily >= that same threshold too — so the zone's full totals (not just its "new" slice)
// are exactly its lifetime-to-date figures.
export function getLifecycleNewZones(filters = {}) {
  const ageMonths = resolveAgeMonths(filters.ageMonths);
  const { branch, productType, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, productType, bigLotFilter }, [
    VALID_LOT_CREATE,
    `"Zone" IS NOT NULL AND TRIM("Zone") != ''`,
  ]);

  const rows = getDb().prepare(`
    SELECT
      TRIM("Branch")              AS branch,
      TRIM("Material Type Desc.") AS productType,
      TRIM("Zone")                AS zone,
      MIN("Lot Create On")        AS earliestLotCreateOn,
      SUM("Total Stock Case")     AS totalUnits,
      SUM("Total Sold Case")      AS soldUnits,
      SUM("Total Balance Case")   AS balanceUnits,
      SUM("Total Balance Amount") AS balanceValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Branch"), TRIM("Material Type Desc."), TRIM("Zone")
  `).all(...params);

  const nowMI = nowMonthIndex();
  const result = [];
  for (const r of rows) {
    const created = parseYYYYMMDD(r.earliestLotCreateOn);
    if (!created) continue;
    const zoneAgeMonths = Math.max(0, nowMI - monthIndexOf(created));
    if (zoneAgeMonths > ageMonths) continue;
    result.push({
      branch: r.branch,
      productType: r.productType,
      zone: r.zone,
      totalUnitsLaunched: r.totalUnits || 0,
      ageMonths: zoneAgeMonths,
      balanceUnits: r.balanceUnits || 0,
      balanceValue: r.balanceValue || 0,
      sellThroughPct: r.totalUnits > 0 ? ((r.soldUnits || 0) / r.totalUnits) * 100 : 0,
    });
  }

  result.sort((a, b) => b.totalUnitsLaunched - a.totalUnitsLaunched);
  return { rows: result, ageMonths };
}

// Snapshot (current-state only, not a historical time series — see frontend copy) comparison
// of Branch+ProductType+Level combos that currently carry at least one unsold OPEN lot, split
// by whether that combo's Lot Create On age bracket is "new" or "aging". avgSellThroughPct is
// the mean of each *combo's own* overall sell-through (every status, same age bracket) across
// the eligible combos — not a single pooled figure — so one huge combo can't dominate the average.
function computeComboGroupStats(filters, ageComparisonClause) {
  const { where, params } = buildWhere(filters, [VALID_LOT_CREATE, ageComparisonClause]);
  const rows = getDb().prepare(`
    SELECT
      TRIM("Branch") AS branch, TRIM("Material Type Desc.") AS productType, TRIM("Level No") AS level,
      UPPER(TRIM("Status")) AS status,
      "Total Stock Case" AS totalStock, "Total Sold Case" AS totalSold
    FROM master_stock
    ${where}
  `).all(...params);

  const combos = new Map();
  for (const r of rows) {
    const key = `${r.branch}|${r.productType}|${r.level}`;
    if (!combos.has(key)) combos.set(key, { totalStock: 0, totalSold: 0, hasOpen: false });
    const c = combos.get(key);
    c.totalStock += Number(r.totalStock) || 0;
    c.totalSold += Number(r.totalSold) || 0;
    if (r.status === 'OPEN') c.hasOpen = true;
  }

  const eligible = [...combos.values()].filter(c => c.hasOpen);
  const comboCount = eligible.length;
  const avgSellThroughPct = comboCount > 0
    ? eligible.reduce((sum, c) => sum + (c.totalStock > 0 ? (c.totalSold / c.totalStock) * 100 : 0), 0) / comboCount
    : 0;
  return { comboCount, avgSellThroughPct };
}

export function getLifecycleAgentFocus(filters = {}) {
  const ageMonths = resolveAgeMonths(filters.ageMonths);
  const newStats = computeComboGroupStats(filters, `${LOT_CREATE_DATE_EXPR} >= date('now', '-${ageMonths} months')`);
  const agingStats = computeComboGroupStats(filters, `${LOT_CREATE_DATE_EXPR} < date('now', '-${ageMonths} months')`);

  return {
    ageMonths,
    newActiveComboCount: newStats.comboCount,
    newAvgSellThroughPct: newStats.avgSellThroughPct,
    agingActiveComboCount: agingStats.comboCount,
    agingAvgSellThroughPct: agingStats.avgSellThroughPct,
  };
}

const router = Router();

router.post('/filters', (req, res) => {
  try {
    res.json(getLifecycleFilters(req.body || {}));
  } catch (err) {
    console.error('Lifecycle filters error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/overview', (req, res) => {
  try {
    res.json(getLifecycleOverview(req.body || {}));
  } catch (err) {
    console.error('Lifecycle overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/curve', (req, res) => {
  try {
    res.json(getLifecycleCurve(req.body || {}));
  } catch (err) {
    console.error('Lifecycle curve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/cohort-table', (req, res) => {
  try {
    res.json(getLifecycleCohortTable(req.body || {}));
  } catch (err) {
    console.error('Lifecycle cohort-table error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/suite-breakdown', (req, res) => {
  try {
    res.json(getLifecycleSuiteBreakdown(req.body || {}));
  } catch (err) {
    console.error('Lifecycle suite-breakdown error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/level-breakdown', (req, res) => {
  try {
    res.json(getLifecycleLevelBreakdown(req.body || {}));
  } catch (err) {
    console.error('Lifecycle level-breakdown error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/new-zones', (req, res) => {
  try {
    res.json(getLifecycleNewZones(req.body || {}));
  } catch (err) {
    console.error('Lifecycle new-zones error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/agent-focus', (req, res) => {
  try {
    res.json(getLifecycleAgentFocus(req.body || {}));
  } catch (err) {
    console.error('Lifecycle agent-focus error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
