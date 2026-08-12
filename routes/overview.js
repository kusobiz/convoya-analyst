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
// against zero isn't a meaningful ratio. Mirrors public/js/velocity.js's veloPctChange.
function pctChange(curr, prev) {
  if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

const TREND_METRICS = ['totalStock', 'totalSold', 'totalBalance', 'sellThroughPct', 'balanceValue'];

// One row per month captured by scripts/excel_to_sqlite.py at update time (see its own
// comments) — monthly_snapshots is the only place this app retains more than the current
// month's data, since master_stock itself is fully replaced on every monthly update.
export function getMonthlyTrend() {
  const rows = getDb().prepare(`
    SELECT
      year_month        AS yearMonth,
      total_stock       AS totalStock,
      total_sold        AS totalSold,
      total_balance     AS totalBalance,
      sell_through_pct  AS sellThroughPct,
      balance_value     AS balanceValue
    FROM monthly_snapshots
    ORDER BY year_month ASC
  `).all();

  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const momPct = {};
    for (const metric of TREND_METRICS) momPct[metric] = pctChange(r[metric], prev ? prev[metric] : null);
    return { ...r, momPct };
  });
}

const router = Router();

router.get('/monthly-trend', (req, res) => {
  try {
    res.json({ rows: getMonthlyTrend() });
  } catch (err) {
    console.error('Overview monthly-trend error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
