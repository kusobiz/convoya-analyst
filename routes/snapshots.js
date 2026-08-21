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

// null (blank/dash) when either side is missing or the prior period is zero — a % change
// against zero isn't a meaningful ratio. Mirrors routes/overview.js's identical helper.
function pctChange(curr, prev) {
  if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

const TREND_METRICS = ['totalStock', 'totalSold', 'totalBalance', 'sellThroughPct', 'balanceValue'];

// Backed by monthly_snapshots_detail — captured by scripts/excel_to_sqlite.py at every monthly
// upload, independent of "Sales Date" data quality (see CLAUDE.md and the Sales Velocity /
// Product Lifecycle reliability banners). lotType omitted matches the core zone-level row
// (lot_type IS NULL, captured for every product type); passed, matches that specific flat-land
// Lot Type row (only captured for flat-land product types — see the script's FLAT_TYPES).
export function getZoneTrend({ branch, productType, zone, lotType } = {}) {
  if (!branch || !productType || !zone) return [];

  const clauses = [
    `UPPER(TRIM(branch)) = UPPER(TRIM(?))`,
    `UPPER(TRIM(product_type)) = UPPER(TRIM(?))`,
    `UPPER(TRIM(zone)) = UPPER(TRIM(?))`,
  ];
  const params = [branch, productType, zone];
  if (lotType) {
    clauses.push(`UPPER(TRIM(lot_type)) = UPPER(TRIM(?))`);
    params.push(lotType);
  } else {
    clauses.push(`lot_type IS NULL`);
  }

  const rows = getDb().prepare(`
    SELECT
      year_month       AS yearMonth,
      total_stock       AS totalStock,
      total_sold        AS totalSold,
      total_balance     AS totalBalance,
      balance_value     AS balanceValue,
      sell_through_pct  AS sellThroughPct
    FROM monthly_snapshots_detail
    WHERE ${clauses.join(' AND ')}
    ORDER BY year_month ASC
  `).all(...params);

  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const momPct = {};
    for (const metric of TREND_METRICS) momPct[metric] = pctChange(r[metric], prev ? prev[metric] : null);
    return { ...r, momPct };
  });
}

const router = Router();

router.get('/zone-trend', (req, res) => {
  try {
    const { branch, productType, zone, lotType } = req.query;
    res.json({ rows: getZoneTrend({ branch, productType, zone, lotType }) });
  } catch (err) {
    console.error('Snapshots zone-trend error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
