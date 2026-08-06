import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');

let db = null;
let rowCache = null;

function getDb() {
  if (!db) db = new Database(DB_PATH, { readonly: true });
  return db;
}

function parseLotDate(val) {
  if (!val) return null;
  const s = String(val);
  if (s.length === 8) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  }
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

export function loadStockData() {
  if (rowCache) return rowCache;
  const rows = getDb().prepare(`
    SELECT
      "Branch", "Material Type Desc.", "Division Code", "Status",
      "Sales Status", "Price Range", "Lot Type",
      "Total Stock Case", "Total Sold Case", "Total Balance Case",
      "Total Balance Amount", "Unit Price",
      "BD Focus Zone", "Lot Create On"
    FROM master_stock
  `).all();

  rowCache = rows.map(r => ({
    branch:          String(r['Branch'] ?? '').trim(),
    materialType:    String(r['Material Type Desc.'] ?? '').trim(),
    divisionCode:    String(r['Division Code'] ?? '').trim(),
    status:          String(r['Status'] ?? '').trim().toUpperCase(),
    salesStatus:     String(r['Sales Status'] ?? '').trim(),
    priceRange:      String(r['Price Range'] ?? '').trim(),
    lotType:         String(r['Lot Type'] ?? '').trim(),
    totalStock:      Number(r['Total Stock Case'] ?? 0),
    totalSold:       Number(r['Total Sold Case'] ?? 0),
    totalBalance:    Number(r['Total Balance Case'] ?? 0),
    totalBalanceAmt: Number(r['Total Balance Amount'] ?? 0),
    unitPrice:       Number(r['Unit Price'] ?? 0),
    bdFocusZone:     String(r['BD Focus Zone'] ?? '').trim().toLowerCase() === 'yes',
    lotCreatedOn:    parseLotDate(r['Lot Create On']),
  }));
  return rowCache;
}

export function refreshCache() {
  rowCache = null;
}

// "Big Lot" = Unit Price >= 500,000 MYR, matching the existing "≥500k" Price Range tier.
function bigLotClause(bigLotFilter) {
  if (bigLotFilter === 'exclude') return `"Unit Price" < 500000`;
  if (bigLotFilter === 'only') return `"Unit Price" >= 500000`;
  return null;
}

function bigLotWhere(filters = {}, extra = []) {
  const clauses = [...extra];
  const clause = bigLotClause(filters.bigLotFilter);
  if (clause) clauses.push(clause);
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

export function getOverview(filters = {}) {
  const where = bigLotWhere(filters);
  const row = getDb().prepare(`
    SELECT
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalValue
    FROM master_stock
    ${where}
  `).get();
  const { totalStock, totalSold, totalBalance, totalValue } = row;
  const sellThrough = totalStock > 0 ? (totalSold / totalStock) * 100 : 0;
  return { totalStock, totalSold, totalBalance, sellThrough, totalValue };
}

export function getBranches() {
  return getDb().prepare(`
    SELECT DISTINCT TRIM("Branch") AS branch
    FROM master_stock
    WHERE "Branch" IS NOT NULL AND TRIM("Branch") != ''
    ORDER BY branch
  `).all().map(r => r.branch);
}

export function getBranchSummary(filters = {}) {
  const where = bigLotWhere(filters);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Branch"), 'Unknown') AS branch,
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Branch")
  `).all();
  return rows.map(r => ({
    ...r,
    sellThrough: r.totalStock > 0 ? (r.totalSold / r.totalStock) * 100 : 0,
  })).sort((a, b) => b.sellThrough - a.sellThrough);
}

export function getProductSummary(filters = {}) {
  const where = bigLotWhere(filters);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Material Type Desc."), 'Unknown') AS product,
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Material Type Desc.")
  `).all();
  return rows.map(r => ({
    ...r,
    sellThrough: r.totalStock > 0 ? (r.totalSold / r.totalStock) * 100 : 0,
  })).sort((a, b) => b.sellThrough - a.sellThrough);
}

export function getBDFocusSummary(filters = {}) {
  const where = bigLotWhere(filters, [`LOWER(TRIM("BD Focus Zone")) = 'yes'`]);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Branch"), 'Unknown') AS branch,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalValue,
      COUNT(*)                    AS count
    FROM master_stock
    ${where}
    GROUP BY TRIM("Branch")
  `).all();
  return rows.map(r => ({
    ...r,
    avgValuePerUnit: r.totalBalance > 0 ? r.totalValue / r.totalBalance : 0,
    priority: r.totalBalance >= 10000 ? 'Critical'
            : r.totalBalance >= 5000  ? 'High'
            : r.totalBalance >= 2000  ? 'Medium'
            : 'Low',
  })).sort((a, b) => b.totalBalance - a.totalBalance);
}

export function getStatusBreakdown(filters = {}) {
  const where = bigLotWhere(filters);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(UPPER(TRIM("Status")), 'UNKNOWN') AS status,
      COUNT(*)                    AS count,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalValue
    FROM master_stock
    ${where}
    GROUP BY UPPER(TRIM("Status"))
  `).all();
  return rows.sort((a, b) => b.count - a.count);
}

export function getPriceRangeSummary(filters = {}) {
  const where = bigLotWhere(filters);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Price Range"), 'Unknown') AS priceRange,
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Price Range")
  `).all();
  return rows.map(r => ({
    ...r,
    sellThrough: r.totalStock > 0 ? (r.totalSold / r.totalStock) * 100 : 0,
  })).sort((a, b) => b.sellThrough - a.sellThrough);
}

export function getLotTypeSummary(filters = {}) {
  const where = bigLotWhere(filters);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Lot Type"), 'Unknown') AS lotType,
      SUM("Total Stock Case")     AS totalStock,
      SUM("Total Sold Case")      AS totalSold,
      SUM("Total Balance Case")   AS totalBalance,
      SUM("Total Balance Amount") AS totalValue
    FROM master_stock
    ${where}
    GROUP BY TRIM("Lot Type")
  `).all();
  return rows.map(r => ({
    ...r,
    sellThrough: r.totalStock > 0 ? (r.totalSold / r.totalStock) * 100 : 0,
  })).sort((a, b) => b.sellThrough - a.sellThrough);
}

export function getAgedStock(filters = {}) {
  const where = bigLotWhere(filters, [
    `UPPER(TRIM("Status")) = 'OPEN'`,
    `"Lot Create On" IS NOT NULL`,
    `"Lot Create On" != ''`,
  ]);
  const rows = getDb().prepare(`
    SELECT
      TRIM("Branch")              AS branch,
      TRIM("Material Type Desc.") AS product,
      TRIM("Lot Type")            AS lotType,
      "Total Balance Case"        AS balance,
      "Total Balance Amount"      AS value,
      "Lot Create On"             AS lotCreatedOn
    FROM master_stock
    ${where}
  `).all();

  const now = new Date();
  return rows.map(r => {
    const created = parseLotDate(r.lotCreatedOn);
    const agedays = created ? Math.floor((now - created) / (1000 * 60 * 60 * 24)) : 0;
    return {
      branch:    r.branch,
      product:   r.product,
      lotType:   r.lotType,
      balance:   r.balance,
      value:     r.value,
      agedays,
      ageBucket: agedays > 730 ? '>2 years'
               : agedays > 365 ? '1–2 years'
               : agedays > 180 ? '6–12 months'
               : '< 6 months',
    };
  }).sort((a, b) => b.agedays - a.agedays);
}

export function getBranchProductMatrix(filters = {}) {
  const where = bigLotWhere(filters);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(TRIM("Branch"), 'Unknown')              AS branch,
      COALESCE(TRIM("Material Type Desc."), 'Unknown') AS product,
      SUM("Total Stock Case") AS totalStock,
      SUM("Total Sold Case")  AS totalSold
    FROM master_stock
    ${where}
    GROUP BY TRIM("Branch"), TRIM("Material Type Desc.")
  `).all();

  const cell = {};
  for (const r of rows) {
    if (!cell[r.branch]) cell[r.branch] = {};
    cell[r.branch][r.product] = { stock: r.totalStock, sold: r.totalSold };
  }

  const branches = Object.keys(cell).sort();
  const productSet = new Set();
  branches.forEach(b => Object.keys(cell[b]).forEach(p => productSet.add(p)));
  const products = Array.from(productSet).sort();

  const matrix = {};
  for (const b of branches) {
    matrix[b] = {};
    for (const p of products) {
      const c = cell[b]?.[p];
      matrix[b][p] = c && c.stock > 0 ? (c.sold / c.stock) * 100 : null;
    }
  }
  return { branches, products, matrix };
}
