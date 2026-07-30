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

function distinctColumn(col, whereClause, params, upper = false) {
  const expr = upper ? `UPPER(TRIM("${col}"))` : `TRIM("${col}")`;
  const notEmpty = `"${col}" IS NOT NULL AND TRIM("${col}") != ''`;
  const sql = whereClause
    ? `SELECT DISTINCT ${expr} AS val FROM master_stock ${whereClause} AND ${notEmpty} ORDER BY val`
    : `SELECT DISTINCT ${expr} AS val FROM master_stock WHERE ${notEmpty} ORDER BY val`;
  return getDb().prepare(sql).all(...params).map(r => r.val);
}

export function getMaterialTypes() {
  return distinctColumn('Material Type Desc.', '', []);
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
    const filters = req.body || {};
    const mode = classifyMaterialTypes(filters.materialType) || 'structured';
    const rows = queryLots(filters);
    res.json({ rows, mode });
  } catch (err) {
    console.error('Lots query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Material type list + structured/flat classification for the selected type(s).
router.get('/filters', (req, res) => {
  try {
    const materialTypes = getMaterialTypes();
    const mode = classifyMaterialTypes(req.query.materialType);
    res.json({ materialTypes, mode });
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
