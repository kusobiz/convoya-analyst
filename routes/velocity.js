import { Router } from 'express';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { classifyMaterialTypes } from './lots.js';

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

// "Sales Date" is a placeholder equal to "Lot Create On" for unsold OPEN lots — only rows
// with actual sold cases carry a real sale date, so every query here is scoped to it.
const SOLD_ONLY = `"Total Sold Case" > 0`;

// Reshape the integer YYYYMMDD "Sales Date" down to a YYYYMM string for monthly grouping.
const SALES_YM_EXPR = `substr(CAST("Sales Date" AS TEXT), 1, 6)`;
const VALID_YM_GUARD = `${SALES_YM_EXPR} GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'`;

const FILTER_COLUMNS = {
  branch:      'Branch',
  productType: 'Material Type Desc.',
  zone:        'Zone',
  suiteNo:     'Suite No',
  section:     'Section',
  level:       'Level No',
  eyeLevel:    'Eye Level/Non Eye Level',
  lotType:     'Lot Type',
};

// splitBy accepts a subset of FILTER_COLUMNS' keys — suiteNo/section aren't offered as split
// dimensions (too granular to chart as separate lines).
const SPLIT_COLUMNS = {
  branch:      'Branch',
  productType: 'Material Type Desc.',
  zone:        'Zone',
  level:       'Level No',
  eyeLevel:    'Eye Level/Non Eye Level',
  lotType:     'Lot Type',
};

// Zone/Suite No/Section/Level codes are reused independently across branches (e.g. Zone "E"
// exists under KR, KL, SA, and SE as four unrelated physical locations) — splitting by one of
// these with more than one branch in scope needs Branch folded into the GROUP BY too, or rows
// from different branches sharing a code silently merge into one series.
const LOCATION_SPLIT_KEYS = ['zone', 'suiteNo', 'section', 'level'];

// "Big Lot" = Unit Price >= 500,000 MYR, matching the existing "≥500k" Price Range tier.
function bigLotClause(bigLotFilter) {
  if (bigLotFilter === 'exclude') return `"Unit Price" < 500000`;
  if (bigLotFilter === 'only') return `"Unit Price" >= 500000`;
  return null;
}

// Every filter accepts either a single value or an array — empty/missing means "All" (no filter).
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
  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function distinctColumn(col, whereSql, params) {
  const notEmpty = `"${col}" IS NOT NULL AND TRIM("${col}") != ''`;
  const sql = whereSql
    ? `SELECT DISTINCT TRIM("${col}") AS val FROM master_stock ${whereSql} AND ${notEmpty} ORDER BY val`
    : `SELECT DISTINCT TRIM("${col}") AS val FROM master_stock WHERE ${notEmpty} ORDER BY val`;
  return getDb().prepare(sql).all(...params).map(r => r.val);
}

// Full sold-lot Sales Date span across the whole dataset, independent of the current filter
// selection — backs the time-period selector's custom From/To dropdowns and "All Time" preset,
// which should reflect what the data actually covers rather than the current narrowed query.
function getDateRange() {
  const row = getDb().prepare(`
    SELECT MIN(${SALES_YM_EXPR}) AS min, MAX(${SALES_YM_EXPR}) AS max
    FROM master_stock
    WHERE ${SOLD_ONLY} AND ${VALID_YM_GUARD}
  `).get();
  return { min: row?.min ?? null, max: row?.max ?? null };
}

export function getSalesVelocity(body = {}) {
  const { splitBy, ...filters } = body;
  const splitCol = splitBy && splitBy !== 'none' ? SPLIT_COLUMNS[splitBy] : null;
  if (splitBy && splitBy !== 'none' && !splitCol) {
    throw new Error(`Invalid splitBy: ${splitBy}`);
  }

  const branchList = toArray(filters.branch).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
  // Ambiguous only when the split dimension's codes aren't branch-unique AND more than one
  // branch is actually in scope — a single explicit Branch pick has nothing to disambiguate.
  const needsBranchDisambiguation = LOCATION_SPLIT_KEYS.includes(splitBy) && branchList.length !== 1;

  const { where, params } = buildWhere(filters, [SOLD_ONLY, VALID_YM_GUARD]);
  const branchSelect = needsBranchDisambiguation ? `COALESCE(TRIM("Branch"), 'Unknown') AS branchValue,` : '';
  const branchGroupBy = needsBranchDisambiguation ? `, TRIM("Branch")` : '';
  const splitSelect = splitCol ? `COALESCE(TRIM("${splitCol}"), 'Unknown') AS splitValue,` : '';
  const splitGroupBy = splitCol ? `, TRIM("${splitCol}")` : '';

  const rows = getDb().prepare(`
    SELECT
      ${SALES_YM_EXPR} AS salesYearMonth,
      ${branchSelect}
      ${splitSelect}
      SUM("Total Sold Case") AS units,
      SUM("Sold Amount")     AS value
    FROM master_stock
    ${where}
    GROUP BY ${SALES_YM_EXPR}${branchGroupBy}${splitGroupBy}
    ORDER BY ${SALES_YM_EXPR}
  `).all(...params);

  const seriesMap = new Map();
  for (const r of rows) {
    const rawSplitValue = splitCol ? r.splitValue : 'All';
    // Prefixing Branch here (rather than in the frontend) means every downstream consumer of
    // splitValue — chart legend/tooltip, table headers, Excel/PDF export — inherits the
    // disambiguated label for free, with no special-casing needed anywhere else.
    const splitValue = needsBranchDisambiguation ? `${r.branchValue} - ${rawSplitValue}` : rawSplitValue;
    if (!seriesMap.has(splitValue)) seriesMap.set(splitValue, []);
    seriesMap.get(splitValue).push({ yearMonth: r.salesYearMonth, units: r.units, value: r.value });
  }

  const series = Array.from(seriesMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([splitValue, points]) => ({
      splitValue,
      points: points.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)),
    }));

  return { series };
}

// Cascading options, each dimension scoped by every dimension before it in the
// branch → productType → zone → suiteNo → section → level → eyeLevel → lotType
// order — mirrors routes/lots.js's location cascade, extended with the sales-specific
// dimensions. All scoped to SOLD_ONLY so no dropdown offers a combo with zero sold lots.
export function getVelocityFilters(filters = {}) {
  const { branch, productType, zone, suiteNo, section, level, eyeLevel, lotType, bigLotFilter } = filters;
  const base = [SOLD_ONLY];

  const { where: w0, params: p0 } = buildWhere({ bigLotFilter }, base);
  const branches = distinctColumn('Branch', w0, p0);

  const { where: w1, params: p1 } = buildWhere({ branch, bigLotFilter }, base);
  const productTypes = distinctColumn('Material Type Desc.', w1, p1);

  const mode = classifyMaterialTypes(productType);

  const { where: w2, params: p2 } = buildWhere({ branch, productType, bigLotFilter }, base);
  const zones = distinctColumn('Zone', w2, p2);

  const { where: w3, params: p3 } = buildWhere({ branch, productType, zone, bigLotFilter }, base);
  const suiteNos = distinctColumn('Suite No', w3, p3);

  const { where: w4, params: p4 } = buildWhere({ branch, productType, zone, suiteNo, bigLotFilter }, base);
  const sections = distinctColumn('Section', w4, p4);

  const { where: w5, params: p5 } = buildWhere({ branch, productType, zone, suiteNo, section, bigLotFilter }, base);
  const levels = distinctColumn('Level No', w5, p5);

  const { where: w6, params: p6 } = buildWhere({ branch, productType, zone, suiteNo, section, level, bigLotFilter }, base);
  const eyeLevels = distinctColumn('Eye Level/Non Eye Level', w6, p6);

  const { where: w7, params: p7 } = buildWhere({ branch, productType, zone, suiteNo, section, level, eyeLevel, bigLotFilter }, base);
  const lotTypes = distinctColumn('Lot Type', w7, p7);

  return { branches, productTypes, zones, suiteNos, sections, levels, eyeLevels, lotTypes, mode, dateRange: getDateRange() };
}

const router = Router();

router.post('/sales', (req, res) => {
  try {
    const result = getSalesVelocity(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Velocity sales error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/filters', (req, res) => {
  try {
    const result = getVelocityFilters(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Velocity filters error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
