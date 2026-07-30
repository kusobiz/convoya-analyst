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

// Location hierarchy: Branch → Zone → Suite No → Section → Level No
const FILTER_COLUMNS = {
  branch:  'Branch',
  zone:    'Zone',
  suiteNo: 'Suite No',
  section: 'Section',
  level:   'Level No',
  status:  'Status',
};

function buildWhere(filters) {
  const clauses = [];
  const params = [];
  for (const [key, col] of Object.entries(FILTER_COLUMNS)) {
    const val = filters[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      clauses.push(`UPPER(TRIM("${col}")) = UPPER(TRIM(?))`);
      params.push(String(val));
    }
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export function queryLots(filters = {}) {
  const { where, params } = buildWhere(filters);
  return getDb().prepare(`
    SELECT
      COALESCE(TRIM("Zone"), 'Unknown')          AS zone,
      COALESCE(TRIM("Level No"), 'Unknown')      AS level,
      COALESCE(UPPER(TRIM("Status")), 'UNKNOWN') AS status,
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalBalanceAmount,
      COUNT(*)                    AS lotCount
    FROM master_stock
    ${where}
    GROUP BY TRIM("Zone"), TRIM("Level No"), UPPER(TRIM("Status"))
    ORDER BY TRIM("Zone"), TRIM("Level No")
  `).all(...params);
}

export function getZones(branch) {
  let sql = `SELECT DISTINCT TRIM("Zone") AS zone FROM master_stock WHERE "Zone" IS NOT NULL AND TRIM("Zone") != ''`;
  const params = [];
  if (branch) {
    sql += ` AND UPPER(TRIM("Branch")) = UPPER(TRIM(?))`;
    params.push(String(branch));
  }
  sql += ` ORDER BY zone`;
  return getDb().prepare(sql).all(...params).map(r => r.zone);
}

function distinctColumn(col, whereClause, params, upper = false) {
  const expr = upper ? `UPPER(TRIM("${col}"))` : `TRIM("${col}")`;
  const notEmpty = `"${col}" IS NOT NULL AND TRIM("${col}") != ''`;
  const sql = whereClause
    ? `SELECT DISTINCT ${expr} AS val FROM master_stock ${whereClause} AND ${notEmpty} ORDER BY val`
    : `SELECT DISTINCT ${expr} AS val FROM master_stock WHERE ${notEmpty} ORDER BY val`;
  return getDb().prepare(sql).all(...params).map(r => r.val);
}

// Suite numbers are scoped by branch + zone (the suite itself hasn't been chosen yet).
export function getSuiteNos(filters = {}) {
  const { branch, zone } = filters;
  const { where, params } = buildWhere({ branch, zone });
  return distinctColumn('Suite No', where, params);
}

// Sections are scoped by branch + zone + suite.
export function getSections(filters = {}) {
  const { branch, zone, suiteNo } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo });
  return distinctColumn('Section', where, params);
}

// Levels are scoped by the full location cascade selected so far.
export function getLevels(filters = {}) {
  const { branch, zone, suiteNo, section } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, section });
  return distinctColumn('Level No', where, params);
}

// Statuses are scoped by whatever of the cascade has been selected so far.
export function getStatuses(filters = {}) {
  const { branch, zone, suiteNo, section } = filters;
  const { where, params } = buildWhere({ branch, zone, suiteNo, section });
  return distinctColumn('Status', where, params, true);
}

const router = Router();

router.post('/', (req, res) => {
  try {
    const rows = queryLots(req.body || {});
    res.json({ rows });
  } catch (err) {
    console.error('Lots query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/zones', (req, res) => {
  try {
    const zones = getZones(req.query.branch);
    res.json({ zones });
  } catch (err) {
    console.error('Lot zones query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/suites', (req, res) => {
  try {
    const { branch, zone } = req.query;
    const suites   = getSuiteNos({ branch, zone });
    const statuses = getStatuses({ branch, zone });
    res.json({ suites, statuses });
  } catch (err) {
    console.error('Lot suites query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sections', (req, res) => {
  try {
    const { branch, zone, suiteNo } = req.query;
    const sections = getSections({ branch, zone, suiteNo });
    const statuses = getStatuses({ branch, zone, suiteNo });
    res.json({ sections, statuses });
  } catch (err) {
    console.error('Lot sections query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/levels', (req, res) => {
  try {
    const { branch, zone, suiteNo, section } = req.query;
    const levels   = getLevels({ branch, zone, suiteNo, section });
    const statuses = getStatuses({ branch, zone, suiteNo, section });
    res.json({ levels, statuses });
  } catch (err) {
    console.error('Lot levels query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
