// One-time seed of zone_attributes with owner-confirmed ground-truth tiers/eras/religion types.
// Safe to re-run: clears the table first, then re-inserts this exact confirmed dataset — there
// is no other source of rows before manual entries are added via the Product Attributes UI.
//
// Zone/Suite prefix rules are stored as the bare prefix text (e.g. zone 'BK-', suite 'HB-') —
// routes/attributes.js matches these with "exact match first, else LIKE 'PREFIX%'" so no
// schema flag is needed to distinguish exact vs. prefix rows.
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');

const rows = [];
function add(branch, zone, opts = {}) {
  rows.push({
    branch,
    zone,
    suiteNo: opts.suiteNo ?? null,
    lotType: opts.lotType ?? null,
    tier: opts.tier ?? null,
    era: opts.era ?? null,
    religion: opts.religion ?? null,
    notes: opts.notes ?? null,
    // Every zone/suite row here is Niche-derived; the two branch='ALL' universal Lot Type rules
    // (Super Family / Royal Family) apply across every flat-land product type, not just Niche,
    // so they're left product_type NULL to keep matching universally — see routes/attributes.js.
    productType: branch === 'ALL' ? null : 'NV Niche',
  });
}

// ── KL, Buddhist-Taoist, Legacy ──
const KL_BT_LEGACY_LOW = ['01','02','03','05','06','07','08','09','10','11','12','13','15','16','17','18','19','20','21','22','23','25','26','27','28','29','30','31','32','33','35','36','37','38','39','50','51','52'];
for (const z of KL_BT_LEGACY_LOW) add('KL', z, { tier: 'Low', era: 'Legacy', religion: 'Buddhist-Taoist' });
add('KL', 'BK-', { tier: 'Mid', era: 'Legacy', religion: 'Buddhist-Taoist' });
add('KL', 'CFC', { tier: 'High', era: 'Legacy', religion: 'Buddhist-Taoist' });

// ── KL, Christian, Legacy ──
for (const z of ['EPHESIANS', 'PHILIPPIANS']) add('KL', z, { religion: 'Christian', era: 'Legacy' });

// ── KL, Buddhist-Taoist, Modern ──
for (const z of ['MC1', 'MC2']) add('KL', z, { tier: 'Low', era: 'Modern', religion: 'Buddhist-Taoist' });
add('KL', 'JLD-', { tier: 'Mid', era: 'Modern', religion: 'Buddhist-Taoist' });
add('KL', 'OV', { tier: 'High', era: 'Modern', religion: 'Buddhist-Taoist' });

// ── KL, Christian, Modern ──
for (const z of ['ES3', 'ETERNAL SUITE', 'ETERNAL SUITE 2']) add('KL', z, { religion: 'Christian', era: 'Modern' });

// ── SA, Buddhist-Taoist, Legacy ──
add('SA', 'HC', { tier: 'Low', era: 'Legacy', religion: 'Buddhist-Taoist' });
for (const z of ['TV1', 'TV2']) add('SA', z, { tier: 'Mid', era: 'Legacy', religion: 'Buddhist-Taoist' });
for (const z of ['MP1', 'MP2']) add('SA', z, { tier: 'High', era: 'Legacy', religion: 'Buddhist-Taoist' });

// ── SA, Christian, Legacy ──
add('SA', 'PG1', { religion: 'Christian', era: 'Legacy' });

// ── SA, Buddhist-Taoist, Modern ──
add('SA', 'HC', { tier: 'Low', era: 'Modern', religion: 'Buddhist-Taoist' });
for (const z of ['SV2', 'SV3']) add('SA', z, { tier: 'Mid', era: 'Modern', religion: 'Buddhist-Taoist' });
add('SA', 'MP3', { tier: 'High', era: 'Modern', religion: 'Buddhist-Taoist' });

// ── SA, Christian, Modern ──
const PG2_NOTE = 'Suite prefix pattern inferred from owner description, verify if new suite codes appear';
add('SA', 'PG2', { suiteNo: 'A', tier: 'Mid', era: 'Modern', religion: 'Christian', notes: PG2_NOTE });
add('SA', 'PG2', { suiteNo: 'D', tier: 'Low', era: 'Modern', religion: 'Christian', notes: PG2_NOTE });

// ── GX, Modern, Buddhist-Taoist ──
for (const z of ['D1', 'D2', 'D5']) add('GX', z, { tier: 'Low', era: 'Modern', religion: 'Buddhist-Taoist' });
for (const z of ['B1', 'B2']) add('GX', z, { tier: 'Mid', era: 'Modern', religion: 'Buddhist-Taoist' });
add('GX', 'D5', { suiteNo: 'PS9', tier: 'Mid', era: 'Modern', religion: 'Buddhist-Taoist' });
add('GX', 'D5', { suiteNo: 'PS1', tier: 'Mid', era: 'Modern', religion: 'Buddhist-Taoist', notes: 'Not yet in current data, expected to appear in a future month' });
for (const z of ['A1', 'A2']) add('GX', z, { tier: 'High', era: 'Modern', religion: 'Buddhist-Taoist' });
add('GX', 'SKY', { suiteNo: 'S18', tier: 'High', era: 'Modern', religion: 'Buddhist-Taoist' });
add('GX', 'SKY', { suiteNo: 'S38', tier: 'High', era: 'Modern', religion: 'Buddhist-Taoist' });

// ── GX, Family suites (tier left unset — inherits the zone-level tier via lookup fallback) ──
add('GX', 'A2', { suiteNo: 'S3' });
add('GX', 'A2', { suiteNo: 'S5' });

// ── GX, Modern, Christian (tier left unset — inherits the zone-level tier via lookup fallback) ──
add('GX', 'B1', { suiteNo: 'S1', era: 'Modern', religion: 'Christian' });
add('GX', 'B1', { suiteNo: 'S10', era: 'Modern', religion: 'Christian' });
add('GX', 'B2', { suiteNo: 'S7', era: 'Modern', religion: 'Christian' });
add('GX', 'B2', { suiteNo: 'S8', era: 'Modern', religion: 'Christian' });

// ── N3, Buddhist-Taoist ── (Low tier: not yet assigned, no row)
add('N3', 'N7', { tier: 'Mid', religion: 'Buddhist-Taoist' });
add('N3', 'V7', { tier: 'High', religion: 'Buddhist-Taoist' });

// ── N3, Christian ──
add('N3', 'N12', { religion: 'Christian', notes: 'Not yet in current data, expected next month' });

// ── SE, Buddhist-Taoist ──
add('SE', 'GS', { tier: 'Low', religion: 'Buddhist-Taoist' });
add('SE', 'BK-A', { suiteNo: 'HA', tier: 'Low', religion: 'Buddhist-Taoist' });
add('SE', 'BK-A', { suiteNo: 'HG', tier: 'Low', religion: 'Buddhist-Taoist' });
add('SE', 'BK-A', { suiteNo: 'HB-', tier: 'Mid', religion: 'Buddhist-Taoist' });
add('SE', 'BK-A', { suiteNo: 'HD-', tier: 'High', religion: 'Buddhist-Taoist' });
add('SE', 'STUPA', { tier: 'High', religion: 'Buddhist-Taoist' });

// ── IJ, Buddhist-Taoist ── (High: not yet assigned)
add('IJ', 'SUITE 1', { tier: 'Low', religion: 'Buddhist-Taoist' });
add('IJ', 'MANSION 1', { tier: 'Mid', religion: 'Buddhist-Taoist' });

// ── IP, Buddhist-Taoist ── (High: unassigned — NG1/NG2/NG3, NV MAJESTIC 1/2 intentionally left unset)
add('IP', 'EG1', { tier: 'Low', religion: 'Buddhist-Taoist' });
add('IP', 'FMN-', { tier: 'Low', religion: 'Buddhist-Taoist' });
add('IP', 'FLB', { tier: 'Low', religion: 'Buddhist-Taoist' });
add('IP', 'PV', { tier: 'Low', religion: 'Buddhist-Taoist' });
add('IP', 'TV-PAVILION', { tier: 'Mid', religion: 'Buddhist-Taoist' });

// ── KR, Buddhist-Taoist ──
add('KR', 'UA', { tier: 'Low', religion: 'Buddhist-Taoist' });
for (const z of ['U', 'PV1', 'PV2']) add('KR', z, { tier: 'Mid', religion: 'Buddhist-Taoist' });
add('KR', 'PV5', { tier: 'High', religion: 'Buddhist-Taoist' });

// ── KN, Buddhist-Taoist ── (High: not yet assigned)
add('KN', 'TV-BK-B', { suiteNo: 'H1', tier: 'Low', religion: 'Buddhist-Taoist' });
add('KN', 'TV-BK-B', { suiteNo: 'H2', tier: 'Mid', religion: 'Buddhist-Taoist' });

// ── Universal Lot Type rules (Burial Plot) — apply regardless of zone ──
add('ALL', 'ALL', { lotType: 'SUPER FAMILY', tier: 'High' });
// Source data spells this "ROYAL FAMLIY" (verified against master_stock's actual Lot Type
// values) — seeded with the real spelling so matching works; flagged for the data owner in
// case the source Excel's spelling is ever corrected in a future monthly load.
add('ALL', 'ALL', {
  lotType: 'ROYAL FAMLIY', tier: 'High',
  notes: 'Owner-confirmed rule is "ROYAL FAMILY"; source data spells the Lot Type value "ROYAL FAMLIY" (typo). Seeded using the actual data spelling so matching works — update if the source Excel is ever corrected.',
});

// FAMILY lot type intentionally gets no fixed-tier row — it's Mid/High "typically" but not
// fixed; routes/attributes.js warns (non-blocking) if a user sets a FAMILY row's tier to Low.

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS zone_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch TEXT NOT NULL,
    zone TEXT NOT NULL,
    suite_no TEXT,
    lot_type TEXT,
    intended_tier TEXT,
    era TEXT,
    religion_type TEXT,
    walkway_width TEXT,
    walkway_proximity TEXT,
    gazebo_proximity TEXT,
    elevation_tier TEXT,
    notes TEXT,
    product_type TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_zone_attributes_lookup ON zone_attributes(branch, zone, suite_no, lot_type)`);
// Older DBs created before product_type existed won't get it from CREATE TABLE IF NOT EXISTS.
const existingCols = db.prepare(`PRAGMA table_info(zone_attributes)`).all().map(c => c.name);
if (!existingCols.includes('product_type')) db.exec(`ALTER TABLE zone_attributes ADD COLUMN product_type TEXT`);

db.exec('DELETE FROM zone_attributes');
const insert = db.prepare(`
  INSERT INTO zone_attributes
    (branch, zone, suite_no, lot_type, intended_tier, era, religion_type, notes, product_type)
  VALUES (@branch, @zone, @suiteNo, @lotType, @tier, @era, @religion, @notes, @productType)
`);
const insertMany = db.transaction((allRows) => { for (const r of allRows) insert.run(r); });
insertMany(rows);

console.log(`Seeded ${rows.length} rows into zone_attributes.`);
db.close();
