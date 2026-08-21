import { Router } from 'express';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stripProductPrefix as stripNVPrefix } from '../src/format.js';

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

// Same normalization buildWhere's SQL IN-clause uses (trim + uppercase) — lets callers who
// already have an in-memory cohort/group list (branch embedded on every record) filter it by
// branch without a second SQL round trip. Empty/missing branch means "no filter, match all".
function normalizedFilterList(val) {
  return toArray(val).map(v => String(v).trim().toUpperCase()).filter(Boolean);
}
function matchesNormalizedList(value, normalizedList) {
  return normalizedList.length === 0 || normalizedList.includes(String(value ?? '').trim().toUpperCase());
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
// buildCohortsFromSql — rather than only reachable one drill-down step down.
const SUITE_GROUPED_TYPES = ['NV Niche', 'NV Baby Paradise'];
function isSuiteGrouped(productType) {
  return SUITE_GROUPED_TYPES.includes(productType);
}

// ── Migration-artifact date detection ──
// A "Lot Create On" date shared by an outsized fraction of a branch's total lot count almost
// certainly reflects a one-time system-migration batch load (every pre-existing lot stamped with
// the migration run's date), not real launch activity on that day — confirmed against KL Burial
// Plot, where 20181117/20181118 alone account for ~87% of all rows, and the zones anchored
// entirely to those two dates are already ~98% sold (vs ~86% for genuinely-dated zones), i.e.
// pre-existing legacy inventory carried into the system, not a real November 2018 launch. 15% is
// comfortably below KL's ~18-58% per-date share while still well above what a real (even large)
// single-day launch batch would plausibly hit for a whole branch's cumulative lot count across
// its full history.
const MIGRATION_DATE_THRESHOLD_PCT = 15;

// Keyed by normalized branch — expensive to scan a branch's full lot history, and this data only
// ever changes on a monthly reload, so it's computed once per branch and kept for the life of the
// process. clearMigrationDateCache() (called from server.js's /api/refresh) is the only way to
// force a recompute short of a restart.
const migrationDateCache = new Map();

export function clearMigrationDateCache() {
  migrationDateCache.clear();
}

// Returns the Set of "Lot Create On" values (as their raw CAST...AS TEXT form, e.g. "20181117")
// flagged as migration artifacts for this branch — every lot on a flagged date, regardless of
// product type or zone, is a candidate; buildCohortsFromSql below decides per-cohort whether
// enough of a specific cohort's own lots actually fall on one to flag the cohort itself.
export function detectMigrationDates(branch) {
  const key = String(branch || '').trim().toUpperCase();
  if (!key) return new Set();
  if (migrationDateCache.has(key)) return migrationDateCache.get(key);

  const rows = getDb().prepare(`
    SELECT CAST("Lot Create On" AS TEXT) AS lotCreateOn, COUNT(*) AS n
    FROM master_stock
    WHERE UPPER(TRIM("Branch")) = ?
    GROUP BY "Lot Create On"
  `).all(key);

  const total = rows.reduce((sum, r) => sum + r.n, 0);
  const flagged = new Set();
  if (total > 0) {
    for (const r of rows) {
      if (!r.lotCreateOn) continue;
      if ((r.n / total) * 100 > MIGRATION_DATE_THRESHOLD_PCT) flagged.add(r.lotCreateOn);
    }
  }
  migrationDateCache.set(key, flagged);
  return flagged;
}

// "20181117" -> "2018-11-17", for display.
function formatLotCreateOn(raw) {
  if (!raw || raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// ── Cohort grouping (shared by /curve and /cohort-table) ──
// "Lot Create On"/"Sales Date" are stored as integer YYYYMMDD — these expressions derive a
// month-index (year*12+month) and CohortPeriod ("YYYY-Qn") directly in SQL, the same values
// parseYYYYMMDD/monthIndexOf/cohortPeriodOf used to compute in JS per-row. Pushing this into the
// GROUP BY (see buildCohortsFromSql) means SQLite returns one row per cohort instead of one row
// per lot — for the ~260k-row master_stock table that's the difference between ~1,000 JS objects
// and ~260,000, which is what was pushing the app over its PM2 memory ceiling under concurrent
// requests.
const LOT_YEAR_EXPR = `CAST(substr(CAST("Lot Create On" AS TEXT), 1, 4) AS INTEGER)`;
const LOT_MONTH_EXPR = `CAST(substr(CAST("Lot Create On" AS TEXT), 5, 2) AS INTEGER)`;
const LOT_MONTH_INDEX_EXPR = `(${LOT_YEAR_EXPR} * 12 + ${LOT_MONTH_EXPR})`;
const COHORT_PERIOD_EXPR = `(${LOT_YEAR_EXPR} || '-Q' || (((${LOT_MONTH_EXPR} - 1) / 3) + 1))`;
const SALES_MONTH_INDEX_EXPR = `(
  CAST(substr(CAST("Sales Date" AS TEXT), 1, 4) AS INTEGER) * 12 +
  CAST(substr(CAST("Sales Date" AS TEXT), 5, 2) AS INTEGER)
)`;

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
// raw material) only counts rows with a real sale (Total Sold Case > 0 — unsold OPEN/RESERVED
// lots are always excluded here regardless of what their own Sales Date happens to hold; it's
// not reliably a placeholder equal to Lot Create On, since it can also get touched on a status
// change that isn't a sale), bucketed by that lot's own monthsSinceLaunch = its Sales Date
// month index minus its own Lot Create On month index.
// Picks the value with the largest weighted count out of a Map(value -> weight) — used for
// Eye Level, since a cohort's raw rows can carry a mix of "Eye Level"/"Non Eye Level"/blank
// (unlike Price Range, which is derived from a single avgPrice number), so the cohort's own
// Eye Level for peer-grouping purposes is whichever value the bulk of its units actually carry.
function dominantFromCounts(counts) {
  let dominant = 'Unknown', max = -1;
  for (const [k, v] of counts) { if (v > max) { max = v; dominant = k; } }
  return dominant;
}

// Suite-grouping key as a SQL expression, mirroring isSuiteGrouped/SUITE_GROUPED_TYPES: NULL
// (its own "no suite data" bucket, same as the old JS suiteNo: null) unless the product type is
// suite-grouped AND Suite No is actually populated for this row.
const SUITE_KEY_EXPR = `(CASE WHEN TRIM("Material Type Desc.") IN ('${SUITE_GROUPED_TYPES.join("','")}')
  THEN NULLIF(TRIM("Suite No"), '') ELSE NULL END)`;
const COHORT_GROUP_SELECT = `
  TRIM("Branch")              AS branch,
  TRIM("Material Type Desc.") AS productType,
  TRIM("Zone")                AS zone,
  ${SUITE_KEY_EXPR}           AS suiteNo,
  ${COHORT_PERIOD_EXPR}       AS cohortPeriod
`;
const COHORT_GROUP_BY = `branch, productType, zone, suiteNo, cohortPeriod`;

// Replaces the old fetch-every-matching-row-then-group-in-JS approach with two GROUP BY
// aggregate queries — SQLite returns one row per cohort (or per cohort+eyeLevel / cohort+month
// for the two queries below) instead of one row per lot, so JS only ever materializes
// O(cohorts) objects, not O(rows) — for master_stock's ~260k rows that's ~1,000 cohort objects
// instead of ~260,000 row objects (see CLAUDE.md's stated principle — src/reader.js uses SQL
// GROUP BY for the same reason).
function buildCohortsFromSql(filters) {
  const { where, params } = buildWhere(filters, [VALID_LOT_CREATE]);

  // Grouping by cohort+eyeLevel (instead of just cohort) gets the per-eyeLevel unit totals
  // dominantFromCounts needs for free, in the same query, rather than a separate round trip.
  const totalsRows = getDb().prepare(`
    SELECT
      ${COHORT_GROUP_SELECT},
      COALESCE(NULLIF(TRIM("Eye Level/Non Eye Level"), ''), 'Unknown') AS eyeLevel,
      SUM("Total Stock Case")     AS totalUnits,
      SUM("Total Sold Case")      AS soldUnits,
      SUM("Total Balance Case")   AS balanceUnits,
      SUM("Total Balance Amount") AS balanceValue,
      SUM(CASE WHEN "Unit Price" > 0 THEN "Unit Price" ELSE 0 END) AS priceSum,
      SUM(CASE WHEN "Unit Price" > 0 THEN 1 ELSE 0 END)            AS priceCount
    FROM master_stock
    ${where}
    GROUP BY ${COHORT_GROUP_BY}, eyeLevel
  `).all(...params);

  // "Total Sold Case" > 0 is the only reliable way to exclude never-sold OPEN/RESERVED rows —
  // their Sales Date isn't a dependable placeholder equal to Lot Create On (it can carry a more
  // recent date from a non-sale status change), so this mirrors the old per-row `if (totalSold >
  // 0)` guard directly on the sale signal rather than on Sales Date's shape. No separate
  // NULL/blank check is needed on top, same as the row-based version relied on parseYYYYMMDD
  // succeeding for every real Lot Create On/Sales Date pair.
  const soldByMonthRows = getDb().prepare(`
    SELECT
      ${COHORT_GROUP_SELECT},
      (${SALES_MONTH_INDEX_EXPR} - ${LOT_MONTH_INDEX_EXPR}) AS monthsSinceLaunch,
      SUM("Total Sold Case") AS sold
    FROM master_stock
    ${where} AND "Total Sold Case" > 0
      AND (${SALES_MONTH_INDEX_EXPR} - ${LOT_MONTH_INDEX_EXPR}) >= 0
    GROUP BY ${COHORT_GROUP_BY}, monthsSinceLaunch
  `).all(...params);

  // Per-cohort breakdown by raw "Lot Create On" date — lets each cohort be checked against its
  // OWN branch's flagged migration dates (detectMigrationDates), since a peer/cross-branch query
  // here can span multiple branches each with their own distinct migration dates. "Total Stock
  // Case" is always 1 per master_stock row (verified against the live data), so summing it here
  // is equivalent to counting lots, matching detectMigrationDates' own COUNT(*)-based threshold.
  const lotDateRows = getDb().prepare(`
    SELECT
      ${COHORT_GROUP_SELECT},
      CAST("Lot Create On" AS TEXT) AS lotCreateOn,
      SUM("Total Stock Case") AS units
    FROM master_stock
    ${where}
    GROUP BY ${COHORT_GROUP_BY}, lotCreateOn
  `).all(...params);

  const cohortKey = (r) => `${r.branch}|${r.productType}|${r.zone}|${r.suiteNo}|${r.cohortPeriod}`;

  const cohorts = new Map();
  for (const r of totalsRows) {
    const key = cohortKey(r);
    if (!cohorts.has(key)) {
      cohorts.set(key, {
        branch: r.branch, productType: r.productType, zone: r.zone,
        suiteNo: r.suiteNo, cohortPeriod: r.cohortPeriod,
        totalUnits: 0, soldUnits: 0, balanceUnits: 0, balanceValue: 0,
        priceSum: 0, priceCount: 0,
        eyeLevelCounts: new Map(),
        soldByMonth: new Map(),
        migrationDateUnits: new Map(),
      });
    }
    const c = cohorts.get(key);
    c.totalUnits += r.totalUnits || 0;
    c.soldUnits += r.soldUnits || 0;
    c.balanceUnits += r.balanceUnits || 0;
    c.balanceValue += r.balanceValue || 0;
    c.priceSum += r.priceSum || 0;
    c.priceCount += r.priceCount || 0;
    c.eyeLevelCounts.set(r.eyeLevel, (c.eyeLevelCounts.get(r.eyeLevel) || 0) + (r.totalUnits || 0));
  }
  for (const r of soldByMonthRows) {
    const c = cohorts.get(cohortKey(r));
    if (!c) continue;
    c.soldByMonth.set(r.monthsSinceLaunch, (c.soldByMonth.get(r.monthsSinceLaunch) || 0) + (r.sold || 0));
  }
  for (const r of lotDateRows) {
    const c = cohorts.get(cohortKey(r));
    if (!c || !r.lotCreateOn) continue;
    const flaggedDates = detectMigrationDates(r.branch);
    if (flaggedDates.has(r.lotCreateOn)) {
      c.migrationDateUnits.set(r.lotCreateOn, (c.migrationDateUnits.get(r.lotCreateOn) || 0) + (r.units || 0));
    }
  }

  // A cohort is a migration artifact when a high percentage (>90%) of its own units sit on ONE
  // of its branch's flagged dates — not "any flagged units at all", so a genuine multi-year zone
  // that happens to include a handful of migrated legacy lots isn't misclassified.
  const MIGRATION_ARTIFACT_THRESHOLD = 0.9;

  const nowMI = nowMonthIndex();
  const list = [];
  for (const c of cohorts.values()) {
    const ageMonthsNow = Math.max(0, nowMI - cohortPeriodStartMonthIndex(c.cohortPeriod));
    const totalMigrationUnits = Array.from(c.migrationDateUnits.values()).reduce((a, b) => a + b, 0);
    const isMigrationArtifact = c.totalUnits > 0 && (totalMigrationUnits / c.totalUnits) > MIGRATION_ARTIFACT_THRESHOLD;
    const migrationDate = isMigrationArtifact ? dominantFromCounts(c.migrationDateUnits) : null;
    list.push({
      ...c,
      ageMonthsNow,
      avgPrice: c.priceCount > 0 ? c.priceSum / c.priceCount : 0,
      overallSellThroughPct: c.totalUnits > 0 ? (c.soldUnits / c.totalUnits) * 100 : 0,
      eyeLevel: dominantFromCounts(c.eyeLevelCounts),
      isMigrationArtifact,
      migrationDate: migrationDate ? formatLotCreateOn(migrationDate) : null,
      cohortLabel: `${c.branch} - ${stripNVPrefix(c.productType)} - Zone ${c.zone}`
        + (c.suiteNo !== null ? ` - Suite ${c.suiteNo}` : isSuiteGrouped(c.productType) ? ' - No Suite Data' : '')
        + ` - ${c.cohortPeriod}`,
    });
  }
  return list;
}

// Merges CohortPeriod-grained cohorts (buildCohortsFromSql' output) into one record per
// Branch+ProductType+Zone (or +SuiteNo for SUITE_GROUPED_TYPES) — Newly Launched Zones &
// Suites' grain, coarser than the Cohort Table's. A "launch" here means the group's OWN
// earliest CohortPeriod, so soldByMonth from each sub-cohort is re-based onto that common
// origin (offset by how many months later that sub-cohort's own quarter started) before being
// summed, giving one coherent cumulative-sell-through curve for cohortStatusFlag/
// computePeerStats to run on — the same shape a single buildCohortsFromSql cohort has, just
// spanning however many quarters this zone/suite has actually launched lots in.
function buildZoneSuiteGroups(cohorts) {
  const groups = new Map();
  for (const c of cohorts) {
    const key = isSuiteGrouped(c.productType)
      ? `${c.branch}|${c.productType}|${c.zone}|${c.suiteNo}`
      : `${c.branch}|${c.productType}|${c.zone}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const nowMI = nowMonthIndex();
  const list = [];
  for (const subCohorts of groups.values()) {
    const earliestStartMI = Math.min(...subCohorts.map(c => cohortPeriodStartMonthIndex(c.cohortPeriod)));
    const ageMonthsNow = Math.max(0, nowMI - earliestStartMI);

    let totalUnits = 0, soldUnits = 0, balanceUnits = 0, balanceValue = 0, priceSum = 0, priceCount = 0;
    const soldByMonth = new Map();
    const eyeLevelCounts = new Map();
    for (const c of subCohorts) {
      totalUnits += c.totalUnits;
      soldUnits += c.soldUnits;
      balanceUnits += c.balanceUnits;
      balanceValue += c.balanceValue;
      priceSum += c.priceSum;
      priceCount += c.priceCount;
      for (const [ev, cnt] of c.eyeLevelCounts) eyeLevelCounts.set(ev, (eyeLevelCounts.get(ev) || 0) + cnt);
      const offset = cohortPeriodStartMonthIndex(c.cohortPeriod) - earliestStartMI;
      for (const [m, sold] of c.soldByMonth) {
        const rebasedM = m + offset;
        soldByMonth.set(rebasedM, (soldByMonth.get(rebasedM) || 0) + sold);
      }
    }
    const first = subCohorts[0];
    list.push({
      branch: first.branch, productType: first.productType, zone: first.zone, suiteNo: first.suiteNo,
      cohortPeriod: undefined,
      totalUnits, soldUnits, balanceUnits, balanceValue,
      avgPrice: priceCount > 0 ? priceSum / priceCount : 0,
      overallSellThroughPct: totalUnits > 0 ? (soldUnits / totalUnits) * 100 : 0,
      eyeLevel: dominantFromCounts(eyeLevelCounts),
      ageMonthsNow, soldByMonth,
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
  const includeLegacy = filters.includeLegacy === true;
  const cohorts = buildCohortsFromSql(filters);

  // Largest cohorts by unit count first, so the chart doesn't get overcrowded.
  cohorts.sort((a, b) => b.totalUnits - a.totalUnits);

  // Migration-artifact cohorts are excluded from the "top cohorts by size" selection entirely by
  // default (their misleadingly-flat curves would otherwise crowd out genuine ones — KL Burial
  // Plot's migrated zones are already ~98% sold, so they dominate any size-based ranking) —
  // includeLegacy: true opts back in, at which point they're still returned (with
  // isMigrationArtifact/migrationDate) so the frontend can render them dashed/muted instead.
  const eligible = includeLegacy ? cohorts : cohorts.filter(c => !c.isMigrationArtifact);

  const result = eligible.slice(0, maxCohorts).map(c => {
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
      isMigrationArtifact: c.isMigrationArtifact, migrationDate: c.migrationDate,
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

const STATUS_FLAGS = ['New', 'Steady', 'Slowing', 'Stagnant', 'Sold Out', 'Legacy'];
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

// ── Peer Benchmark presets ──
// Product Type is always part of every preset (never compare across different product types).
const PEER_PRESET_LABELS = {
  'product-price':          'Same Product Type & Price Range',
  'product-price-branch':   '+ Same Branch',
  'product-price-eyelevel': '+ Same Eye Level',
  'product-only':           'Product Type Only (broadest)',
};
const PEER_PRESETS = Object.keys(PEER_PRESET_LABELS);
function resolvePeerPreset(preset) {
  return PEER_PRESETS.includes(preset) ? preset : 'product-price';
}

// The peer-group key for a cohort under a given preset — shared by every peer-grouping call
// site (getLifecycleCohortTable, getLifecycleNewZonesAndSuites, getLifecyclePeerDetail) so they
// can never drift out of sync with each other.
function peerGroupKeyFor(c, preset, priceRangeBands) {
  const tier = priceRangeTierFor(c.productType, c.avgPrice, priceRangeBands);
  if (preset === 'product-only') return c.productType;
  if (preset === 'product-price-branch') return `${c.productType}|${tier}|${c.branch}`;
  if (preset === 'product-price-eyelevel') return `${c.productType}|${tier}|${c.eyeLevel}`;
  return `${c.productType}|${tier}`; // 'product-price' (default)
}

function buildPeerGroups(peerUniverse, preset, priceRangeBands) {
  const peerGroups = new Map();
  for (const c of peerUniverse) {
    const key = peerGroupKeyFor(c, preset, priceRangeBands);
    if (!peerGroups.has(key)) peerGroups.set(key, []);
    peerGroups.get(key).push(c);
  }
  return peerGroups;
}

// Identity match used to exclude a cohort from its own peer group — `cohorts`/`peerUniverse`
// (or their zone/suite-merged equivalents) always come from separate fetches/builds, so this is
// never the same object even for the identical real-world cohort. cohortPeriod is undefined on
// every buildZoneSuiteGroups record, so it's a harmless no-op discriminator at that grain
// (branch+zone+suiteNo+productType alone is already the full key there).
function isSameCohortIdentity(a, b) {
  return a.branch === b.branch && a.zone === b.zone && a.suiteNo === b.suiteNo &&
    a.productType === b.productType && a.cohortPeriod === b.cohortPeriod;
}

// Peer group = same preset key, excluding the cohort itself, only including peers old enough to
// have reached this cohort's own ageMonthsNow checkpoint (so a 2-month-old peer never gets
// asked for its cumulative sell-through at month 24).
function findPeersFor(c, preset, priceRangeBands, peerGroups) {
  const group = peerGroups.get(peerGroupKeyFor(c, preset, priceRangeBands)) || [];
  return group.filter(p => p.ageMonthsNow >= c.ageMonthsNow && !isSameCohortIdentity(p, c));
}

// Below 3 qualifying peers, the comparison is "Insufficient Data" rather than a benchmark
// computed from a statistically meaningless handful of cohorts.
function computePeerStats(c, peers) {
  if (peers.length < 3) return { peerBenchmarkPct: null, peerComparison: 'Insufficient Data' };
  const peerBenchmarkPct = peers.reduce((sum, p) => sum + cumulativePctAt(p, c.ageMonthsNow), 0) / peers.length;
  const ownPct = cumulativePctAt(c, c.ageMonthsNow);
  const delta = ownPct - peerBenchmarkPct;
  const peerComparison = delta > 10 ? 'Above Peers' : delta < -10 ? 'Below Peers' : 'On Par';
  return { peerBenchmarkPct, peerComparison };
}

// Plain-language rendering of a cohort's own peer group under a preset, e.g. "Niche, Price
// Range ≥30k, Branch: KL" — used by the transparency panel (getLifecyclePeerDetail).
function peerGroupDefinitionText(c, preset, tier) {
  const product = stripNVPrefix(c.productType);
  if (preset === 'product-only') return product;
  if (preset === 'product-price-branch') return `${product}, Price Range ${tier}, Branch: ${c.branch}`;
  if (preset === 'product-price-eyelevel') return `${product}, Price Range ${tier}, ${c.eyeLevel}`;
  return `${product}, Price Range ${tier}`;
}

// The Cohort Table has its own decoupled Branch/Product Type filters (cohortFiltersUI in the
// frontend) — separate from the tab-wide Branch/Product Type filters that drive Overview/Curve/
// New Zones/Agent Focus, same "own independent filters" pattern routes/pricing.js's Pivot
// Builder already uses (pivotFiltersUI). Level is deliberately not one of them: Level is a
// per-row drill-down detail (getLifecycleLevelBreakdown), never a Cohort Table filter dimension.
export function getLifecycleCohortTable(filters = {}) {
  const ageMonths = resolveAgeMonths(filters.ageMonths);
  const { branch, productType, bigLotFilter } = filters;
  const preset = resolvePeerPreset(filters.peerPreset);

  // Peer Benchmark always compares against the full, branch-unscoped set of cohorts (branch is
  // re-applied per-preset below, only for the "+ Same Branch" preset) sharing the same Product
  // Type — a genuine historical benchmark, not narrowed by whichever Branch the Cohort Table's
  // own filters currently show. Product Type and bigLotFilter are still honored (no reason to
  // pull types the user has excluded, and bigLotFilter is a real "exclude these lots from
  // analysis" setting, not a display scope). Fetched ONCE here — `cohorts` (the branch-scoped
  // view the table itself renders) is then just an in-memory filter of this same list rather than
  // a second SQL aggregation, since peerUniverse is always a superset of it.
  const peerUniverse = buildCohortsFromSql({ productType, bigLotFilter });
  const branchList = normalizedFilterList(branch);
  const branchScoped = branchList.length
    ? peerUniverse.filter(c => matchesNormalizedList(c.branch, branchList))
    : peerUniverse;
  // "Exclude Legacy/Migration-Artifact Cohorts" — default ON, consistent with the Lifecycle
  // Curve's own default-excluded behavior. Filtered here (before allRows/the summary cards are
  // built) so a legacy cohort simply isn't part of the result set at all while excluded, matching
  // "excluded from trend analysis by default" — turning the filter off surfaces them again, each
  // carrying isMigrationArtifact/migrationDate so the frontend can render the Legacy badge.
  const excludeLegacy = filters.excludeLegacy !== false;
  const cohorts = excludeLegacy ? branchScoped.filter(c => !c.isMigrationArtifact) : branchScoped;
  const priceRangeBands = getPriceRangeBandsByProductType();
  const peerGroups = buildPeerGroups(peerUniverse, preset, priceRangeBands);

  const allRows = cohorts.map(c => {
    const peers = findPeersFor(c, preset, priceRangeBands, peerGroups);
    const { peerBenchmarkPct, peerComparison } = computePeerStats(c, peers);
    return {
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
      // Migration-artifact cohorts are never eligible for New/Steady/Slowing/Stagnant — their
      // "launch" date is known-unreliable, so classifying their trajectory would be meaningless;
      // 'Legacy' replaces the computed flag outright rather than sitting alongside it.
      statusFlag: c.isMigrationArtifact ? 'Legacy' : cohortStatusFlag(c, ageMonths),
      isMigrationArtifact: c.isMigrationArtifact,
      migrationDate: c.migrationDate,
      peerBenchmarkPct,
      peerComparison,
    };
  });

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
  return { rows, ageMonths, statusFlagSummary, peerComparisonSummary, peerPreset: preset };
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
  // buildCohortsFromSql). buildWhere's normal IN-clause can't express "blank" (its FILTER_
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

// Newly Launched Zones & Suites — one row per Branch+ProductType+Zone (or +SuiteNo for
// SUITE_GROUPED_TYPES, same threshold as the Cohort Table — see isSuiteGrouped) whose EARLIEST
// Lot Create On (across every lot ever recorded in that zone/suite) falls within the last
// ageMonths, i.e. the zone/suite itself is a recent launch, not just a few individual lots
// trickling in. Reuses buildZoneSuiteGroups' own ageMonthsNow (derived from the group's
// earliest CohortPeriod) for that test — since it's a lower bound, every lot in a qualifying
// group is necessarily within the window too, so the group's full totals (not just a "new"
// slice) are exactly its lifetime-to-date figures. Status Flag / Peer Comparison badges use the
// same computation as the Cohort Table, sharing whichever peerPreset the caller passed in.
export function getLifecycleNewZonesAndSuites(filters = {}) {
  const ageMonths = resolveAgeMonths(filters.ageMonths);
  const { branch, productType, bigLotFilter } = filters;
  const preset = resolvePeerPreset(filters.peerPreset);

  // Same "fetch the branch-unscoped peer universe once, derive the branch-scoped view by
  // filtering it in JS" pattern as getLifecycleCohortTable — buildZoneSuiteGroups keys every
  // group by branch already, so filtering post-grouping is equivalent to filtering pre-grouping.
  const peerCohorts = buildCohortsFromSql({ productType, bigLotFilter });
  const peerUniverse = buildZoneSuiteGroups(peerCohorts);
  const branchList = normalizedFilterList(branch);
  const groups = (branchList.length
    ? peerUniverse.filter(g => matchesNormalizedList(g.branch, branchList))
    : peerUniverse
  ).filter(g => g.ageMonthsNow <= ageMonths);
  const priceRangeBands = getPriceRangeBandsByProductType();
  const peerGroups = buildPeerGroups(peerUniverse, preset, priceRangeBands);

  const rows = groups.map(g => {
    const peers = findPeersFor(g, preset, priceRangeBands, peerGroups);
    const { peerBenchmarkPct, peerComparison } = computePeerStats(g, peers);
    return {
      branch: g.branch,
      productType: g.productType,
      zone: g.zone,
      suiteNo: g.suiteNo,
      suiteGrouped: isSuiteGrouped(g.productType),
      totalUnitsLaunched: g.totalUnits,
      ageMonths: g.ageMonthsNow,
      balanceUnits: g.balanceUnits,
      balanceValue: g.balanceValue,
      sellThroughPct: g.overallSellThroughPct,
      statusFlag: cohortStatusFlag(g, ageMonths),
      peerBenchmarkPct,
      peerComparison,
    };
  });

  rows.sort((a, b) => b.totalUnitsLaunched - a.totalUnitsLaunched);
  return { rows, ageMonths, peerPreset: preset };
}

// Peer Benchmark transparency (item 2) — locates the exact cohort a Status Flag/Peer Comparison
// badge belongs to (either a Cohort Table row, when cohortPeriod is given, or a Newly Launched
// Zones & Suites row, when it's omitted — matching buildCohortsFromSql vs buildZoneSuiteGroups'
// two grains) and returns its full peer group under the given preset: the plain-language group
// definition, how many peers, this cohort's own vs. the peer average sell-through at its current
// age, and the largest 5 peer cohorts actually used, so the number can be sanity-checked instead
// of taken on faith.
export function getLifecyclePeerDetail(filters = {}) {
  const { branch, productType, zone, suiteNo, cohortPeriod, bigLotFilter } = filters;
  const preset = resolvePeerPreset(filters.peerPreset);
  const priceRangeBands = getPriceRangeBandsByProductType();

  const suiteList = toArray(suiteNo);
  const wantsBlankSuite = suiteList.length === 1 && suiteList[0] === '';
  const matchesSuite = (c) => wantsBlankSuite ? c.suiteNo === null : (suiteList.length ? c.suiteNo === suiteList[0] : true);

  const peerCohorts = buildCohortsFromSql({ productType: [productType], bigLotFilter });
  const branchList = normalizedFilterList(branch);
  const ownCohorts = branchList.length
    ? peerCohorts.filter(c => matchesNormalizedList(c.branch, branchList))
    : peerCohorts;

  let target, peerUniverse;
  if (cohortPeriod) {
    target = ownCohorts.find(c => c.branch === branch && c.zone === zone && c.cohortPeriod === cohortPeriod && matchesSuite(c));
    peerUniverse = peerCohorts;
  } else {
    target = buildZoneSuiteGroups(ownCohorts).find(g => g.branch === branch && g.zone === zone && matchesSuite(g));
    peerUniverse = buildZoneSuiteGroups(peerCohorts);
  }
  if (!target) return { error: 'Cohort not found' };

  const peerGroups = buildPeerGroups(peerUniverse, preset, priceRangeBands);
  const peers = findPeersFor(target, preset, priceRangeBands, peerGroups);
  const { peerBenchmarkPct, peerComparison } = computePeerStats(target, peers);
  const tier = priceRangeTierFor(target.productType, target.avgPrice, priceRangeBands);

  const topPeers = [...peers]
    .sort((a, b) => b.totalUnits - a.totalUnits)
    .slice(0, 5)
    .map(p => ({
      branch: p.branch,
      zone: p.zone,
      suiteNo: p.suiteNo,
      cohortPeriod: p.cohortPeriod || null,
      sellThroughPctAtAge: cumulativePctAt(p, target.ageMonthsNow),
    }));

  return {
    preset,
    presetLabel: PEER_PRESET_LABELS[preset],
    groupDefinitionText: peerGroupDefinitionText(target, preset, tier),
    peerCount: peers.length,
    ageMonthsNow: target.ageMonthsNow,
    ownSellThroughPct: cumulativePctAt(target, target.ageMonthsNow),
    peerBenchmarkPct,
    peerComparison,
    topPeers,
  };
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

// ── Short-lived response cache ──
// cohort-table/new-zones/curve/agent-focus are the 4 endpoints the Product Lifecycle tab fires
// concurrently via Promise.all on every tab open (see public/js/lifecycle.js), plus whatever
// other users hit around the same time on the same filter view. A 90s TTL means repeat/
// concurrent hits on an identical param set are served from memory instead of re-running a SQL
// aggregation each — source data only reloads monthly (scripts/excel_to_sqlite.py), so 90s of
// staleness is a non-issue. Keyed on the request body only (each route already segregates its
// own cache by using its own key prefix). Pruned opportunistically past 200 entries rather than
// on a timer, since the realistic filter-combination cardinality is small and bounded.
const CACHE_TTL_MS = 90_000;
const CACHE_PRUNE_THRESHOLD = 200;
const responseCache = new Map();

function cacheKey(route, body) {
  const sortedEntries = Object.keys(body || {}).sort().map(k => [k, body[k]]);
  return `${route}:${JSON.stringify(sortedEntries)}`;
}

function setCached(key, data) {
  if (responseCache.size > CACHE_PRUNE_THRESHOLD) {
    const now = Date.now();
    for (const [k, v] of responseCache) {
      if (v.expiresAt <= now) responseCache.delete(k);
    }
  }
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cachedHandler(route, computeFn) {
  return (req, res) => {
    try {
      const body = req.body || {};
      const key = cacheKey(route, body);
      const cached = responseCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.data);
        return;
      }
      const data = computeFn(body);
      setCached(key, data);
      res.json(data);
    } catch (err) {
      console.error(`Lifecycle ${route} error:`, err.message);
      res.status(500).json({ error: err.message });
    }
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

router.post('/curve', cachedHandler('curve', getLifecycleCurve));

router.post('/cohort-table', cachedHandler('cohort-table', getLifecycleCohortTable));

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

router.post('/new-zones', cachedHandler('new-zones', getLifecycleNewZonesAndSuites));

router.post('/peer-detail', (req, res) => {
  try {
    res.json(getLifecyclePeerDetail(req.body || {}));
  } catch (err) {
    console.error('Lifecycle peer-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/agent-focus', cachedHandler('agent-focus', getLifecycleAgentFocus));

export default router;
