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

// Structured types carry Section/Suite/Level; flat land types have no vertical structure.
const STRUCTURED_TYPES = ['NV Niche', 'NV Pedestal', 'NV Pet Niche', 'NV EBL', 'NV Baby Paradise'];
const FLAT_TYPES = ['NV Burial Plot', 'NV Seed', 'NV Urn Burial Plot', 'NV Pet Burial Plot'];

// Sorts Price Range labels (e.g. "≥500k", "<100k") by actual price magnitude, descending —
// the raw DB/alphabetical order reads meaninglessly (e.g. "<100k" sorts before "<10k"). Ties
// at the same magnitude (e.g. "≥100k" vs "<100k") put "≥" before "<", so the dropdown reads
// as one continuous scale from the top tier down. Mirrors routes/pricing.js's copy.
function sortPriceRangesDesc(list) {
  const parse = (s) => {
    const m = String(s).match(/([<≥])\s*([\d.]+)\s*(k|m)?/i);
    if (!m) return { magnitude: -Infinity, isGte: false };
    let magnitude = parseFloat(m[2]);
    const unit = (m[3] || '').toLowerCase();
    if (unit === 'k') magnitude *= 1_000;
    else if (unit === 'm') magnitude *= 1_000_000;
    return { magnitude, isGte: m[1] === '≥' };
  };
  return [...list].sort((a, b) => {
    const pa = parse(a), pb = parse(b);
    if (pa.magnitude !== pb.magnitude) return pb.magnitude - pa.magnitude;
    return (pb.isGte ? 1 : 0) - (pa.isGte ? 1 : 0);
  });
}

export function classifyMaterialType(materialType) {
  if (!materialType) return null;
  const norm = String(materialType).trim().toLowerCase();
  if (STRUCTURED_TYPES.some(t => t.toLowerCase() === norm)) return 'structured';
  if (FLAT_TYPES.some(t => t.toLowerCase() === norm)) return 'flat';
  return null;
}

// Multi-select product type: mixing structured + flat land types falls back to the
// structured view (it's a superset — flat rows just show 'Unknown' Zone/Level).
// A pure flat-land selection is the only case that gets the flat view.
export function classifyMaterialTypes(materialTypes) {
  const list = toArray(materialTypes).map(t => String(t).trim()).filter(Boolean);
  if (!list.length) return null;
  const modes = new Set(list.map(classifyMaterialType));
  if (modes.has('structured')) return 'structured';
  if (modes.size === 1 && modes.has('flat')) return 'flat';
  return null;
}

function toArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

// Location hierarchy: Material Type → Branch → Zone → Suite No → Section → Level No / Lot Type
const FILTER_COLUMNS = {
  materialType: 'Material Type Desc.',
  branch:       'Branch',
  zone:         'Zone',
  suiteNo:      'Suite No',
  section:      'Section',
  level:        'Level No',
  lotType:      'Lot Type',
  status:       'Status',
  priceRange:   'Price Range',
};

// "Big Lot" = Unit Price >= 500,000 MYR, matching the existing "≥500k" Price Range tier.
function bigLotClause(bigLotFilter) {
  if (bigLotFilter === 'exclude') return `"Unit Price" < 500000`;
  if (bigLotFilter === 'only') return `"Unit Price" >= 500000`;
  return null;
}

// Every filter accepts either a single value or an array — empty/missing means "All" (no filter).
function buildWhere(filters) {
  const clauses = [];
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
  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export function queryLots(filters = {}) {
  const { where, params } = buildWhere(filters);
  const mode = classifyMaterialTypes(filters.materialType) || 'structured';

  if (mode === 'flat') {
    return getDb().prepare(`
      SELECT
        COALESCE(TRIM("Material Type Desc."), 'Unknown') AS materialType,
        COALESCE(TRIM("Lot Type"), 'Unknown')      AS lotType,
        COALESCE(UPPER(TRIM("Status")), 'UNKNOWN') AS status,
        SUM("Total Stock Case")     AS totalStock,
        SUM("Total Sold Case")      AS totalSold,
        SUM("Total Balance Case")   AS totalBalance,
        SUM("Total Balance Amount") AS totalBalanceAmount,
        COUNT(*)                    AS lotCount
      FROM master_stock
      ${where}
      GROUP BY TRIM("Material Type Desc."), TRIM("Lot Type"), UPPER(TRIM("Status"))
      ORDER BY TRIM("Lot Type")
    `).all(...params);
  }

  return getDb().prepare(`
    SELECT
      COALESCE(TRIM("Material Type Desc."), 'Unknown') AS materialType,
      COALESCE(TRIM("Zone"), 'Unknown')          AS zone,
      COALESCE(TRIM("Level No"), 'Unknown')      AS level,
      COALESCE(TRIM("Lot Type"), 'Unknown')      AS lotType,
      COALESCE(UPPER(TRIM("Status")), 'UNKNOWN') AS status,
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalBalanceAmount,
      COUNT(*)                    AS lotCount
    FROM master_stock
    ${where}
    GROUP BY TRIM("Material Type Desc."), TRIM("Zone"), TRIM("Level No"), TRIM("Lot Type"), UPPER(TRIM("Status"))
    ORDER BY TRIM("Zone"), TRIM("Level No")
  `).all(...params);
}

// "Lot Create On" is stored as an integer YYYYMMDD (e.g. 20181118) — reshape to
// YYYY-MM-DD so SQLite's julianday() can parse it. Mirrors routes/pricing.js.
const LOT_CREATE_DATE_EXPR = `(
  substr(CAST("Lot Create On" AS TEXT), 1, 4) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 5, 2) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 7, 2)
)`;
const AGE_DAYS_EXPR = `CAST(julianday('now') - julianday(${LOT_CREATE_DATE_EXPR}) AS INTEGER)`;

// Parses "YYYY-Qn" (Product Lifecycle's CohortPeriod) into a [start, end) date range on Lot
// Create On — lets that tab's View Lots scope down to one cohort's exact launch quarter.
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

// Finer-grained lot listing used by cross-tab drill-downs (e.g. Pricing Intelligence)
// that need Suite/Section visibility and per-lot age filtering, beyond the Zone/Level
// summary grain the main Lot Drill-Down table (queryLots) groups at. Reuses the same
// buildWhere/FILTER_COLUMNS filtering as queryLots — only the SELECT/GROUP BY grain differs.
export function queryLotsDetail(filters = {}) {
  const { where, params } = buildWhere(filters);
  const mode = classifyMaterialTypes(filters.materialType) || 'structured';

  const extra = [];
  if (filters.minAgeDays !== undefined && filters.minAgeDays !== null && filters.minAgeDays !== '') {
    extra.push(`${AGE_DAYS_EXPR} > ${Number(filters.minAgeDays)}`);
  }
  const cohortRange = filters.cohortPeriod ? cohortPeriodDateRange(filters.cohortPeriod) : null;
  if (cohortRange) {
    extra.push(`${LOT_CREATE_DATE_EXPR} >= '${cohortRange.start}' AND ${LOT_CREATE_DATE_EXPR} < '${cohortRange.end}'`);
  }
  // A single empty-string suiteNo (Product Lifecycle's "no Suite No data" cohort bucket for its
  // suite-grouped product types) means "lots with no Suite No at all" — buildWhere above already
  // silently dropped it (its universal "blank value = no filter" convention), so the actual
  // blank-filter clause is added here instead, same pattern as cohortPeriod/minAgeDays.
  const suiteNoList = toArray(filters.suiteNo);
  if (suiteNoList.length === 1 && suiteNoList[0] === '') {
    extra.push(`("Suite No" IS NULL OR TRIM("Suite No") = '')`);
  }
  const fullWhere = extra.length
    ? (where ? `${where} AND ${extra.join(' AND ')}` : `WHERE ${extra.join(' AND ')}`)
    : where;

  // Grouped by Material No (globally unique per physical lot) rather than just the
  // location/status dimensions, so every row here maps to exactly one physical lot and
  // can carry that lot's own Material No — the detail grain callers need to actually
  // locate the lot, not a rolled-up summary of many lots.
  if (mode === 'flat') {
    return getDb().prepare(`
      SELECT
        TRIM("Material No")                        AS materialNo,
        COALESCE(TRIM("Branch"), 'Unknown')        AS branch,
        COALESCE(TRIM("Material Type Desc."), 'Unknown') AS materialType,
        COALESCE(TRIM("Lot Type"), 'Unknown')      AS lotType,
        COALESCE(UPPER(TRIM("Status")), 'UNKNOWN') AS status,
        SUM("Total Stock Case")     AS totalStock,
        SUM("Total Sold Case")      AS totalSold,
        SUM("Total Balance Case")   AS totalBalance,
        SUM("Total Balance Amount") AS totalBalanceAmount,
        COUNT(*)                    AS lotCount
      FROM master_stock
      ${fullWhere}
      GROUP BY TRIM("Material No"), TRIM("Branch"), TRIM("Material Type Desc."), TRIM("Lot Type"), UPPER(TRIM("Status"))
      ORDER BY TRIM("Branch"), TRIM("Lot Type"), TRIM("Material No")
    `).all(...params);
  }

  return getDb().prepare(`
    SELECT
      TRIM("Material No")                        AS materialNo,
      COALESCE(TRIM("Branch"), 'Unknown')        AS branch,
      COALESCE(TRIM("Material Type Desc."), 'Unknown') AS materialType,
      COALESCE(TRIM("Zone"), 'Unknown')          AS zone,
      COALESCE(TRIM("Suite No"), 'Unknown')      AS suiteNo,
      COALESCE(TRIM("Section"), 'Unknown')       AS section,
      COALESCE(TRIM("Level No"), 'Unknown')      AS level,
      COALESCE(TRIM("Lot Type"), 'Unknown')      AS lotType,
      COALESCE(UPPER(TRIM("Status")), 'UNKNOWN') AS status,
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalBalanceAmount,
      COUNT(*)                    AS lotCount
    FROM master_stock
    ${fullWhere}
    GROUP BY TRIM("Material No"), TRIM("Branch"), TRIM("Material Type Desc."), TRIM("Zone"), TRIM("Suite No"), TRIM("Section"), TRIM("Level No"), TRIM("Lot Type"), UPPER(TRIM("Status"))
    ORDER BY TRIM("Branch"), TRIM("Zone"), TRIM("Suite No"), TRIM("Section"), TRIM("Level No"), TRIM("Material No")
  `).all(...params);
}

function distinctColumn(col, whereClause, params, upper = false, extraFilter = null) {
  const expr = upper ? `UPPER(TRIM("${col}"))` : `TRIM("${col}")`;
  const conditions = [`"${col}" IS NOT NULL AND TRIM("${col}") != ''`];
  if (extraFilter) conditions.push(extraFilter);
  const sql = whereClause
    ? `SELECT DISTINCT ${expr} AS val FROM master_stock ${whereClause} AND ${conditions.join(' AND ')} ORDER BY val`
    : `SELECT DISTINCT ${expr} AS val FROM master_stock WHERE ${conditions.join(' AND ')} ORDER BY val`;
  return getDb().prepare(sql).all(...params).map(r => r.val);
}

// Material types are scoped by branch (the only filter chosen before this one in the cascade).
export function getMaterialTypes(filters = {}) {
  const { branch, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, bigLotFilter });
  return distinctColumn('Material Type Desc.', where, params);
}

export function getBranches(filters = {}) {
  const { bigLotFilter } = filters;
  const { where, params } = buildWhere({ bigLotFilter });
  return distinctColumn('Branch', where, params);
}

// Price Ranges are scoped by branch + material type, mirroring routes/pricing.js's
// getPricingFilters — a sibling of Zone in the cascade (same dependency depth), not a
// descendant of it. A handful of product types carry the literal string 'false' in Price
// Range because they have no defined price bands; excluded here same as routes/pricing.js.
export function getPriceRanges(filters = {}) {
  const { branch, materialType, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, materialType, bigLotFilter });
  return sortPriceRangesDesc(distinctColumn('Price Range', where, params, false, `TRIM("Price Range") != 'false'`));
}

// Zones are scoped by branch + material type + price range.
export function getZones(filters = {}) {
  const { branch, materialType, priceRange, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, materialType, priceRange, bigLotFilter });
  return distinctColumn('Zone', where, params);
}

// Suite numbers are scoped by branch + material type + price range + zone (the suite itself hasn't been chosen yet).
export function getSuiteNos(filters = {}) {
  const { branch, zone, materialType, priceRange, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, zone, materialType, priceRange, bigLotFilter });
  return distinctColumn('Suite No', where, params);
}

// Sections are scoped by branch + material type + price range + zone + suite.
export function getSections(filters = {}) {
  const { branch, zone, suiteNo, materialType, priceRange, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, materialType, priceRange, bigLotFilter });
  return distinctColumn('Section', where, params);
}

// Levels are scoped by the full location cascade selected so far.
export function getLevels(filters = {}) {
  const { branch, zone, suiteNo, section, materialType, priceRange, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, section, materialType, priceRange, bigLotFilter });
  return distinctColumn('Level No', where, params);
}

// Lot types (flat land branch) are scoped by branch + material type + zone. priceRange is
// optional on top of that — used by the Pricing Intelligence drill-downs' Lot Type filter,
// which scopes to one row's exact Product Type + Price Range + Branch combination so it
// never offers a Lot Type that would return zero results for that row.
export function getLotTypes(filters = {}) {
  const { branch, zone, materialType, priceRange, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, zone, materialType, priceRange, bigLotFilter });
  return distinctColumn('Lot Type', where, params);
}

// Statuses are scoped by whatever of the cascade has been selected so far.
export function getStatuses(filters = {}) {
  const { branch, zone, suiteNo, section, materialType, lotType, priceRange, bigLotFilter } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, section, materialType, lotType, priceRange, bigLotFilter });
  return distinctColumn('Status', where, params, true);
}

const router = Router();

router.post('/', (req, res) => {
  try {
    const { detail, ...filters } = req.body || {};
    const mode = classifyMaterialTypes(filters.materialType) || 'structured';
    const rows = detail ? queryLotsDetail(filters) : queryLots(filters);
    res.json({ rows, mode });
  } catch (err) {
    console.error('Lots query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Material type (scoped by branch) + branch + Price Range lists (Price Range scoped by
// branch + material type, a sibling of Zone in the cascade), and structured/flat
// classification for the selected type(s).
router.get('/filters', (req, res) => {
  try {
    const { branch, materialType, bigLotFilter } = req.query;
    const materialTypes = getMaterialTypes({ branch, bigLotFilter });
    const branches = getBranches({ bigLotFilter });
    const priceRanges = getPriceRanges({ branch, materialType, bigLotFilter });
    const mode = classifyMaterialTypes(materialType);
    res.json({ materialTypes, branches, priceRanges, mode });
  } catch (err) {
    console.error('Lot filters query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/zones', (req, res) => {
  try {
    const { branch, materialType, priceRange, bigLotFilter } = req.query;
    const zones = getZones({ branch, materialType, priceRange, bigLotFilter });
    res.json({ zones });
  } catch (err) {
    console.error('Lot zones query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/suites', (req, res) => {
  try {
    const { branch, zone, materialType, priceRange, bigLotFilter } = req.query;
    const suites   = getSuiteNos({ branch, zone, materialType, priceRange, bigLotFilter });
    const statuses = getStatuses({ branch, zone, materialType, priceRange, bigLotFilter });
    res.json({ suites, statuses });
  } catch (err) {
    console.error('Lot suites query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sections', (req, res) => {
  try {
    const { branch, zone, suiteNo, materialType, priceRange, bigLotFilter } = req.query;
    const sections = getSections({ branch, zone, suiteNo, materialType, priceRange, bigLotFilter });
    const statuses = getStatuses({ branch, zone, suiteNo, materialType, priceRange, bigLotFilter });
    res.json({ sections, statuses });
  } catch (err) {
    console.error('Lot sections query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/levels', (req, res) => {
  try {
    const { branch, zone, suiteNo, section, materialType, priceRange, bigLotFilter } = req.query;
    const levels   = getLevels({ branch, zone, suiteNo, section, materialType, priceRange, bigLotFilter });
    const statuses = getStatuses({ branch, zone, suiteNo, section, materialType, priceRange, bigLotFilter });
    res.json({ levels, statuses });
  } catch (err) {
    console.error('Lot levels query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/lotTypes', (req, res) => {
  try {
    const { branch, zone, materialType, priceRange, bigLotFilter } = req.query;
    const lotTypes = getLotTypes({ branch, zone, materialType, priceRange, bigLotFilter });
    const statuses = getStatuses({ branch, zone, materialType, priceRange, bigLotFilter });
    res.json({ lotTypes, statuses });
  } catch (err) {
    console.error('Lot lotTypes query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
