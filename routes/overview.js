import { Router } from 'express';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');

// Not readonly — this module also owns data_notes, same "CREATE TABLE IF NOT EXISTS on first
// open" pattern as routes/attributes.js owning zone_attributes. data_notes holds short
// human-written explanations for a month's figures (e.g. a product removed from inventory
// shifting the sell-through base), shown under the Monthly Trend chart. Like
// monthly_snapshots, it's untouched by scripts/excel_to_sqlite.py's master_stock replace.
const SEED_NOTES = [
  {
    yearMonth: '2026-09',
    note: 'NV Baby Paradise (KL, zone BP, 1,543 unsold lots) removed from inventory - product physically removed from site. Net stock -738 lots. About 0.45 of the 0.64-point sell-through rise vs August comes from the smaller base; like-for-like improvement is about 0.2 points.',
  },
];

let db = null;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS data_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year_month TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    // Matches on both columns so a seed row is inserted at most once, without blocking any
    // other note later added for the same month.
    const seed = db.prepare(`
      INSERT INTO data_notes (year_month, note)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM data_notes WHERE year_month = ? AND note = ?)
    `);
    for (const { yearMonth, note } of SEED_NOTES) seed.run(yearMonth, note, yearMonth, note);
  }
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

export function getDataNotes() {
  return getDb().prepare(`
    SELECT id, year_month AS yearMonth, note, created_at AS createdAt
    FROM data_notes
    ORDER BY year_month ASC, id ASC
  `).all();
}

export default router;

// Read-only — mounted separately at /api/data-notes (behind requireAuth in server.js).
export const dataNotesRouter = Router();

dataNotesRouter.get('/', (req, res) => {
  try {
    res.json({ notes: getDataNotes() });
  } catch (err) {
    console.error('Data notes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
