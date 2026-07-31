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

// A handful of product types (Baby Paradise, EBL, Pet Burial Plot, Pet Niche, Seed) carry
// literal string 'false' in Price Range because they have no defined price bands — exclude
// them everywhere pricing analysis groups by Price Range.
const REAL_PRICE_RANGE = `"Price Range" IS NOT NULL AND TRIM("Price Range") != '' AND TRIM("Price Range") != 'false'`;

const FILTER_COLUMNS = {
  branch:      'Branch',
  productType: 'Material Type Desc.',
  priceRange:  'Price Range',
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
  return { clauses, params };
}

// Combines the filter clauses above with extra fixed conditions (e.g. Status = OPEN,
// the "real price range" guard) into a single WHERE clause.
function whereClause(filters, extra = []) {
  const { clauses, params } = buildWhere(filters);
  const all = [...clauses, ...extra];
  return { where: all.length ? `WHERE ${all.join(' AND ')}` : '', params };
}

function distinctColumn(col, whereSql, params, extraFilter = null) {
  const notEmpty = `"${col}" IS NOT NULL AND TRIM("${col}") != ''`;
  const conditions = [notEmpty];
  if (extraFilter) conditions.push(extraFilter);
  const clause = whereSql
    ? `${whereSql} AND ${conditions.join(' AND ')}`
    : `WHERE ${conditions.join(' AND ')}`;
  return getDb().prepare(`
    SELECT DISTINCT TRIM("${col}") AS val FROM master_stock ${clause} ORDER BY val
  `).all(...params).map(r => r.val);
}

// Linear-interpolation percentile (numpy default), p in [0, 1].
function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function categorize(row, stats) {
  const { sellThrough, avgPrice, balanceCase, balanceValue } = row;
  const { p75Sell, p40Sell, medianPrice, p25Price, p75Price } = stats;
  // "regardless of price" — dead stock is checked first so a product whose 75th
  // percentile sell-through is itself very low doesn't also read as a sweet spot.
  if (sellThrough < 10) return 'dead_stock';
  if (sellThrough >= p75Sell && avgPrice <= medianPrice) return 'sweet_spot';
  if (sellThrough >= 70 && avgPrice <= p25Price && balanceCase > 0) return 'low_hanging_fruit';
  if (sellThrough <= p40Sell && avgPrice >= p75Price && balanceValue > 1_000_000) return 'long_ignored_gem';
  return 'normal';
}

// "Lot Create On" is stored as an integer YYYYMMDD (e.g. 20181118) — reshape to
// YYYY-MM-DD so SQLite's julianday() can parse it.
const LOT_CREATE_DATE_EXPR = `(
  substr(CAST("Lot Create On" AS TEXT), 1, 4) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 5, 2) || '-' ||
  substr(CAST("Lot Create On" AS TEXT), 7, 2)
)`;

export function getPricingOverview(filters = {}) {
  const { where, params } = whereClause(filters);

  const overall = getDb().prepare(`
    SELECT AVG("Unit Price") AS avgPrice, COUNT(*) AS lotCount
    FROM master_stock
    ${where}
  `).get(...params);

  const byProduct = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Material Type Desc."), 'Unknown') AS productType,
      SUM("Total Stock Case") AS totalStock,
      AVG("Unit Price") AS avgPrice,
      COUNT(*)          AS lotCount
    FROM master_stock
    ${where}
    GROUP BY TRIM("Material Type Desc.")
    ORDER BY TRIM("Material Type Desc.")
  `).all(...params);

  const { where: rangeWhere, params: rangeParams } = whereClause(filters, [REAL_PRICE_RANGE]);
  const priceRangeDistribution = getDb().prepare(`
    SELECT
      TRIM("Material Type Desc.") AS productType,
      TRIM("Price Range")         AS priceRange,
      SUM("Total Stock Case")     AS stock,
      SUM("Total Sold Case")      AS sold,
      SUM("Total Balance Case")   AS balance,
      SUM("Total Balance Amount") AS balanceValue,
      AVG("Unit Price")           AS avgPrice,
      CASE WHEN SUM("Total Stock Case") > 0
        THEN 100.0 * SUM("Total Sold Case") / SUM("Total Stock Case")
        ELSE 0 END AS sellThroughPct
    FROM master_stock
    ${rangeWhere}
    GROUP BY TRIM("Material Type Desc."), TRIM("Price Range")
    ORDER BY TRIM("Material Type Desc."), TRIM("Price Range")
  `).all(...rangeParams);

  return { overall, byProduct, priceRangeDistribution };
}

// Per-Branch breakdown of unsold (OPEN) stock for one Product Type — feeds the expandable
// "+" row under the Overview's Product Type Summary. Unsold Units/Balance Value are OPEN-only
// sums, but Sell-through % still comes from the full stock/sold ratio across all statuses,
// same historical-performance convention used everywhere else (see getPricingQuadrant).
export function getProductBranchBreakdown(filters = {}) {
  const { productType } = filters;
  const { where, params } = whereClause({ productType });

  return getDb().prepare(`
    SELECT
      TRIM("Branch") AS branch,
      SUM(CASE WHEN UPPER(TRIM("Status")) = 'OPEN' THEN "Total Stock Case" ELSE 0 END)     AS unsoldUnits,
      SUM(CASE WHEN UPPER(TRIM("Status")) = 'OPEN' THEN "Total Balance Amount" ELSE 0 END) AS unsoldBalanceValue,
      CASE WHEN SUM("Total Stock Case") > 0
        THEN 100.0 * SUM("Total Sold Case") / SUM("Total Stock Case")
        ELSE 0 END AS sellThrough
    FROM master_stock
    ${where}
    GROUP BY TRIM("Branch")
    HAVING unsoldUnits > 0
    ORDER BY TRIM("Branch")
  `).all(...params);
}

export function getPricingQuadrant(filters = {}) {
  const { branch, productType, minStock = 100 } = filters;
  const { where, params } = whereClause({ branch, productType }, [REAL_PRICE_RANGE]);

  const groups = getDb().prepare(`
    SELECT
      TRIM("Material Type Desc.") AS productType,
      TRIM("Price Range")         AS priceRange,
      TRIM("Branch")               AS branch,
      AVG("Unit Price")            AS avgPrice,
      SUM("Total Stock Case")      AS stockCount,
      SUM("Total Sold Case")       AS soldCount,
      SUM("Total Balance Case")    AS balanceCase,
      SUM("Total Balance Amount")  AS balanceValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Material Type Desc."), TRIM("Price Range"), TRIM("Branch")
    HAVING SUM("Total Stock Case") >= ?
    ORDER BY TRIM("Material Type Desc."), TRIM("Price Range"), TRIM("Branch")
  `).all(...params, minStock).map(row => ({
    ...row,
    sellThrough: row.stockCount > 0 ? (100 * row.soldCount) / row.stockCount : 0,
  }));

  // Percentiles are computed per product, over the filtered (post-minStock) groups for
  // that product — never as a single global threshold across all products.
  const byProduct = new Map();
  for (const row of groups) {
    if (!byProduct.has(row.productType)) byProduct.set(row.productType, []);
    byProduct.get(row.productType).push(row);
  }

  const statsByProduct = new Map();
  for (const [productType, rows] of byProduct) {
    const sellSorted = rows.map(r => r.sellThrough).sort((a, b) => a - b);
    const priceSorted = rows.map(r => r.avgPrice).sort((a, b) => a - b);
    statsByProduct.set(productType, {
      p75Sell: percentile(sellSorted, 0.75),
      p40Sell: percentile(sellSorted, 0.40),
      medianPrice: percentile(priceSorted, 0.5),
      p25Price: percentile(priceSorted, 0.25),
      p75Price: percentile(priceSorted, 0.75),
    });
  }

  return groups.map(row => ({
    productType: row.productType,
    priceRange: row.priceRange,
    branch: row.branch,
    avgPrice: row.avgPrice,
    sellThrough: row.sellThrough,
    balanceValue: row.balanceValue,
    stockCount: row.stockCount,
    category: categorize(row, statsByProduct.get(row.productType)),
  }));
}

export function getAgedInventory(filters = {}) {
  const { branch, productType, priceRange } = filters;
  const { where, params } = whereClause(
    { branch, productType, priceRange },
    [`UPPER(TRIM("Status")) = 'OPEN'`, REAL_PRICE_RANGE]
  );

  return getDb().prepare(`
    WITH aged AS (
      SELECT
        TRIM("Material Type Desc.") AS productType,
        TRIM("Price Range")         AS priceRange,
        "Total Balance Amount"      AS balanceAmount,
        CAST(julianday('now') - julianday(${LOT_CREATE_DATE_EXPR}) AS INTEGER) AS ageDays
      FROM master_stock
      ${where}
    )
    SELECT
      productType,
      priceRange,
      AVG(ageDays)                                                      AS avgAgeDays,
      MAX(ageDays)                                                      AS oldestAgeDays,
      SUM(CASE WHEN ageDays > 365 THEN 1 ELSE 0 END)                    AS countOver365,
      SUM(CASE WHEN ageDays > 365 THEN balanceAmount ELSE 0 END)        AS balanceValueOver365
    FROM aged
    GROUP BY productType, priceRange
    ORDER BY productType, priceRange
  `).all(...params);
}

// Cross-Analysis Pivot Builder — replaces the old fixed Dragon Zone / Eye Level / Family Lot /
// Price Realization toggles with a flexible rows × columns × metric matrix.
const PIVOT_DIMENSIONS = {
  'Branch':      'Branch',
  'Product Type': 'Material Type Desc.',
  'Price Range': 'Price Range',
  'Eye Level':   'Eye Level/Non Eye Level',
  'Family Lot':  'Family Lot',
  'Lot Type':    'Lot Type',
  'Status':      'Status',
};

const PIVOT_METRICS = new Set(['Sell-through %', 'Avg Price', 'Balance Value', 'Unit Count']);

// Raw per-cell sums (not the derived metric) so row/column/grand totals can be computed
// correctly by re-aggregating sums — averaging pre-computed percentages/averages would be wrong.
function pivotMetricValue(metric, agg) {
  if (!agg) return 0;
  switch (metric) {
    case 'Sell-through %': return agg.sumStock > 0 ? (100 * agg.sumSold) / agg.sumStock : 0;
    case 'Avg Price':      return agg.cnt > 0 ? agg.sumPrice / agg.cnt : 0;
    case 'Balance Value':  return agg.sumBalanceValue || 0;
    case 'Unit Count':     return agg.sumStock || 0;
    default:                return 0;
  }
}

function mergePivotAgg(list) {
  return list.reduce((acc, a) => ({
    sumSold:         acc.sumSold + (a?.sumSold || 0),
    sumStock:        acc.sumStock + (a?.sumStock || 0),
    sumBalanceValue: acc.sumBalanceValue + (a?.sumBalanceValue || 0),
    sumPrice:        acc.sumPrice + (a?.sumPrice || 0),
    cnt:             acc.cnt + (a?.cnt || 0),
  }), { sumSold: 0, sumStock: 0, sumBalanceValue: 0, sumPrice: 0, cnt: 0 });
}

export function getPricingPivot(body = {}) {
  const { rowDimension, colDimension, metric, branch, productType } = body;
  const rowCol = PIVOT_DIMENSIONS[rowDimension];
  const colCol = PIVOT_DIMENSIONS[colDimension];
  if (!rowCol || !colCol) throw new Error(`Invalid rowDimension or colDimension`);
  if (rowDimension === colDimension) throw new Error('rowDimension and colDimension must differ');
  if (!PIVOT_METRICS.has(metric)) throw new Error(`Invalid metric: ${metric}`);

  const extra = [
    `"${rowCol}" IS NOT NULL AND TRIM("${rowCol}") != ''`,
    `"${colCol}" IS NOT NULL AND TRIM("${colCol}") != ''`,
  ];
  if (rowDimension === 'Price Range' || colDimension === 'Price Range') extra.push(REAL_PRICE_RANGE);

  const { where, params } = whereClause({ branch, productType }, extra);

  const raw = getDb().prepare(`
    SELECT
      TRIM("${rowCol}") AS rowVal,
      TRIM("${colCol}") AS colVal,
      SUM("Total Sold Case")      AS sumSold,
      SUM("Total Stock Case")     AS sumStock,
      SUM("Total Balance Amount") AS sumBalanceValue,
      SUM("Unit Price")           AS sumPrice,
      COUNT(*)                    AS cnt
    FROM master_stock
    ${where}
    GROUP BY TRIM("${rowCol}"), TRIM("${colCol}")
  `).all(...params);

  const rows = Array.from(new Set(raw.map(r => r.rowVal))).sort();
  const columns = Array.from(new Set(raw.map(r => r.colVal))).sort();

  const cellMap = new Map();
  for (const r of raw) cellMap.set(`${r.rowVal} ${r.colVal}`, r);

  const cells = rows.map(rv => columns.map(cv => pivotMetricValue(metric, cellMap.get(`${rv} ${cv}`))));
  const rowTotals = rows.map(rv => pivotMetricValue(metric, mergePivotAgg(columns.map(cv => cellMap.get(`${rv} ${cv}`)))));
  const colTotals = columns.map(cv => pivotMetricValue(metric, mergePivotAgg(rows.map(rv => cellMap.get(`${rv} ${cv}`)))));
  const grandTotal = pivotMetricValue(metric, mergePivotAgg(raw));

  return { rows, columns, cells, rowTotals, colTotals, grandTotal, metric, rowDimension, colDimension };
}

export function getPricingFilters(filters = {}) {
  const { branch, productType } = filters;

  const branches = distinctColumn('Branch', '', []);

  const { where: productWhere, params: productParams } = whereClause({ branch });
  const productTypes = distinctColumn('Material Type Desc.', productWhere, productParams);

  const { where: rangeWhere, params: rangeParams } = whereClause({ branch, productType });
  const priceRanges = distinctColumn('Price Range', rangeWhere, rangeParams, `TRIM("Price Range") != 'false'`);

  return { branches, productTypes, priceRanges };
}

const router = Router();

router.post('/overview', (req, res) => {
  try {
    const result = getPricingOverview(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Pricing overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/product-branch-breakdown', (req, res) => {
  try {
    const rows = getProductBranchBreakdown(req.body || {});
    res.json({ rows });
  } catch (err) {
    console.error('Pricing product-branch-breakdown error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/quadrant', (req, res) => {
  try {
    const rows = getPricingQuadrant(req.body || {});
    res.json({ rows });
  } catch (err) {
    console.error('Pricing quadrant error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/aged-inventory', (req, res) => {
  try {
    const rows = getAgedInventory(req.body || {});
    res.json({ rows });
  } catch (err) {
    console.error('Pricing aged-inventory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/pivot', (req, res) => {
  try {
    const result = getPricingPivot(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Pricing pivot error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/filters', (req, res) => {
  try {
    const result = getPricingFilters(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Pricing filters error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
