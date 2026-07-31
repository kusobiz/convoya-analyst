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

function distinctColumn(col, whereClause, params, upper = false) {
  const expr = upper ? `UPPER(TRIM("${col}"))` : `TRIM("${col}")`;
  const notEmpty = `"${col}" IS NOT NULL AND TRIM("${col}") != ''`;
  const sql = whereClause
    ? `SELECT DISTINCT ${expr} AS val FROM master_stock ${whereClause} AND ${notEmpty} ORDER BY val`
    : `SELECT DISTINCT ${expr} AS val FROM master_stock WHERE ${notEmpty} ORDER BY val`;
  return getDb().prepare(sql).all(...params).map(r => r.val);
}

// Material types are scoped by branch (the only filter chosen before this one in the cascade).
export function getMaterialTypes(filters = {}) {
  const { branch } = filters;
  const { where, params } = buildWhere({ branch });
  return distinctColumn('Material Type Desc.', where, params);
}

export function getBranches() {
  return distinctColumn('Branch', '', []);
}

// Zones are scoped by branch + material type.
export function getZones(filters = {}) {
  const { branch, materialType } = filters;
  const { where, params } = buildWhere({ branch, materialType });
  return distinctColumn('Zone', where, params);
}

// Suite numbers are scoped by branch + material type + zone (the suite itself hasn't been chosen yet).
export function getSuiteNos(filters = {}) {
  const { branch, zone, materialType } = filters;
  const { where, params } = buildWhere({ branch, zone, materialType });
  return distinctColumn('Suite No', where, params);
}

// Sections are scoped by branch + material type + zone + suite.
export function getSections(filters = {}) {
  const { branch, zone, suiteNo, materialType } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, materialType });
  return distinctColumn('Section', where, params);
}

// Levels are scoped by the full location cascade selected so far.
export function getLevels(filters = {}) {
  const { branch, zone, suiteNo, section, materialType } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, section, materialType });
  return distinctColumn('Level No', where, params);
}

// Lot types (flat land branch) are scoped by branch + material type + zone.
export function getLotTypes(filters = {}) {
  const { branch, zone, materialType } = filters;
  const { where, params } = buildWhere({ branch, zone, materialType });
  return distinctColumn('Lot Type', where, params);
}

// Statuses are scoped by whatever of the cascade has been selected so far.
export function getStatuses(filters = {}) {
  const { branch, zone, suiteNo, section, materialType, lotType } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, section, materialType, lotType });
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

// Material type (scoped by branch) + branch lists, and structured/flat classification for the selected type(s).
router.get('/filters', (req, res) => {
  try {
    const { branch } = req.query;
    const materialTypes = getMaterialTypes({ branch });
    const branches = getBranches();
    const mode = classifyMaterialTypes(req.query.materialType);
    res.json({ materialTypes, branches, mode });
  } catch (err) {
    console.error('Lot filters query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/zones', (req, res) => {
  try {
    const { branch, materialType } = req.query;
    const zones = getZones({ branch, materialType });
    res.json({ zones });
  } catch (err) {
    console.error('Lot zones query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/suites', (req, res) => {
  try {
    const { branch, zone, materialType } = req.query;
    const suites   = getSuiteNos({ branch, zone, materialType });
    const statuses = getStatuses({ branch, zone, materialType });
    res.json({ suites, statuses });
  } catch (err) {
    console.error('Lot suites query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sections', (req, res) => {
  try {
    const { branch, zone, suiteNo, materialType } = req.query;
    const sections = getSections({ branch, zone, suiteNo, materialType });
    const statuses = getStatuses({ branch, zone, suiteNo, materialType });
    res.json({ sections, statuses });
  } catch (err) {
    console.error('Lot sections query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/levels', (req, res) => {
  try {
    const { branch, zone, suiteNo, section, materialType } = req.query;
    const levels   = getLevels({ branch, zone, suiteNo, section, materialType });
    const statuses = getStatuses({ branch, zone, suiteNo, section, materialType });
    res.json({ levels, statuses });
  } catch (err) {
    console.error('Lot levels query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/lotTypes', (req, res) => {
  try {
    const { branch, zone, materialType } = req.query;
    const lotTypes = getLotTypes({ branch, zone, materialType });
    const statuses = getStatuses({ branch, zone, materialType });
    res.json({ lotTypes, statuses });
  } catch (err) {
    console.error('Lot lotTypes query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
