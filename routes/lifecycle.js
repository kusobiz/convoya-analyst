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
  level:       'Level No',
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
  const { branch, productType, bigLotFilter } = filters;

  const { where: branchWhere, params: branchParams } = buildWhere({ bigLotFilter });
  const branches = distinctColumn('Branch', branchWhere, branchParams);

  const { where: productWhere, params: productParams } = buildWhere({ branch, bigLotFilter });
  const productTypes = distinctColumn('Material Type Desc.', productWhere, productParams);

  const { where: levelWhere, params: levelParams } = buildWhere({ branch, productType, bigLotFilter });
  const levels = distinctColumn('Level No', levelWhere, levelParams);

  return { branches, productTypes, levels };
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

// ── Cohort grouping (shared by /curve and /cohort-table) ──
function fetchLifecycleRows(filters) {
  const { where, params } = buildWhere(filters, [VALID_LOT_CREATE]);
  return getDb().prepare(`
    SELECT
      TRIM("Branch")              AS branch,
      TRIM("Material Type Desc.") AS productType,
      TRIM("Level No")            AS level,
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

// Groups raw rows into cohorts (Branch+ProductType+Level+CohortPeriod). Per spec:
// totalUnits/soldUnits/balanceUnits/balanceValue/avgPrice are summed/averaged across every
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
    const key = `${r.branch}|${r.productType}|${r.level}|${cohortPeriod}`;
    if (!cohorts.has(key)) {
      cohorts.set(key, {
        branch: r.branch, productType: r.productType, level: r.level, cohortPeriod,
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
      cohortLabel: `${c.branch} - ${stripNVPrefix(c.productType)} - Level ${c.level} - ${c.cohortPeriod}`,
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
      cohortLabel: c.cohortLabel, branch: c.branch, productType: c.productType, level: c.level,
      cohortPeriod: c.cohortPeriod, totalUnits: c.totalUnits, ageMonthsNow: c.ageMonthsNow, points,
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

export function getLifecycleCohortTable(filters = {}) {
  const ageMonths = resolveAgeMonths(filters.ageMonths);
  const cohorts = buildCohortsFromRows(fetchLifecycleRows(filters));

  const rows = cohorts.map(c => ({
    branch: c.branch,
    productType: c.productType,
    level: c.level,
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
  }));

  rows.sort((a, b) => b.balanceValue - a.balanceValue);
  return { rows, ageMonths };
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

router.post('/agent-focus', (req, res) => {
  try {
    res.json(getLifecycleAgentFocus(req.body || {}));
  } catch (err) {
    console.error('Lifecycle agent-focus error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
