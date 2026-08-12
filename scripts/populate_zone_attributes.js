// One-time additive migration: adds zone_attributes.product_type, backfills it on the
// owner-confirmed rows from scripts/seed_zone_attributes.js, then inserts blank placeholder
// rows (all fields NULL except the identifying combo) for every real Branch/Zone/(Suite No or
// Lot Type)/Product Type combination in master_stock that isn't in zone_attributes yet — so the
// registry has an editable row ready for every real zone/lot-type, not just the ones already
// manually tiered.
//
// Safe to re-run: every insert is guarded by a NOT EXISTS check against the current table, so
// re-running only adds newly-appeared real combos (e.g. after a monthly data refresh) and never
// touches or duplicates a row that's already there — seeded or previously placeholder.
//
// NOTE: if scripts/seed_zone_attributes.js is ever re-run, it does `DELETE FROM zone_attributes`
// first, which wipes out the placeholder rows this script adds. Re-run this script afterward to
// restore them.
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');

const STRUCTURED_TYPES = ['NV Niche', 'NV Pedestal', 'NV Pet Niche', 'NV EBL', 'NV Baby Paradise'];
const FLAT_TYPES = ['NV Burial Plot', 'NV Seed', 'NV Urn Burial Plot', 'NV Pet Burial Plot'];

// Same universal-rule lot types as routes/attributes.js's UNIVERSAL_HIGH_LOT_TYPES — these are
// already covered branch/zone-agnostically by the two seeded branch='ALL' rows, so flat-land
// combos using them are deliberately skipped rather than duplicated as zone-specific rows.
const UNIVERSAL_HIGH_LOT_TYPES = new Set(['SUPER FAMILY', 'ROYAL FAMILY', 'ROYAL FAMLIY']);

function norm(s) {
  return String(s ?? '').trim().toUpperCase();
}

const db = new Database(DB_PATH);

// ── Step 1: add product_type column if missing ──
const cols = db.prepare(`PRAGMA table_info(zone_attributes)`).all().map(c => c.name);
if (!cols.includes('product_type')) {
  db.exec(`ALTER TABLE zone_attributes ADD COLUMN product_type TEXT`);
  console.log('Added product_type column to zone_attributes.');
} else {
  console.log('product_type column already present — skipping ALTER TABLE.');
}

// ── Before counts ──
function countsByProductType() {
  return db.prepare(`
    SELECT
      COALESCE(product_type, '(none)') AS product_type,
      COUNT(*) AS c,
      SUM(CASE WHEN intended_tier IS NOT NULL THEN 1 ELSE 0 END) AS tiered,
      SUM(CASE WHEN intended_tier IS NULL THEN 1 ELSE 0 END) AS blank
    FROM zone_attributes GROUP BY COALESCE(product_type, '(none)') ORDER BY product_type
  `).all();
}
const beforeTotal = db.prepare(`SELECT COUNT(*) c FROM zone_attributes`).get().c;
const beforeByType = countsByProductType();

// ── Step 2: backfill existing seeded rows ──
// The two branch='ALL' universal rules (Super Family / Royal Family = High) apply across every
// flat-land product type, not specifically Niche — they're left with product_type NULL so they
// keep matching universally. Every other pre-existing row came from
// scripts/seed_zone_attributes.js's owner-confirmed Niche zone/suite data, so those get
// product_type = 'NV Niche'.
const backfillResult = db.prepare(`
  UPDATE zone_attributes SET product_type = 'NV Niche'
  WHERE product_type IS NULL AND UPPER(TRIM(branch)) != 'ALL'
`).run();
console.log(`Backfilled product_type = 'NV Niche' on ${backfillResult.changes} pre-existing row(s) (branch != 'ALL').`);

// ── Step 3: populate blank placeholder rows for every real zone ──
const existing = db.prepare(`SELECT branch, zone, suite_no, lot_type, product_type FROM zone_attributes`).all();
const existingStructuredKeys = new Set();
const existingFlatKeys = new Set();
for (const r of existing) {
  existingStructuredKeys.add(`${norm(r.branch)}|${norm(r.zone)}|${norm(r.suite_no)}|${norm(r.product_type)}`);
  existingFlatKeys.add(`${norm(r.branch)}|${norm(r.zone)}|${norm(r.lot_type)}|${norm(r.product_type)}`);
}

const insertBlank = db.prepare(`
  INSERT INTO zone_attributes (branch, zone, suite_no, lot_type, product_type, updated_at)
  VALUES (@branch, @zone, @suiteNo, @lotType, @productType, datetime('now'))
`);

let structuredInserted = 0;
let flatInserted = 0;
let flatSkippedUniversal = 0;
let flatSkippedNullZone = 0;

const insertAll = db.transaction(() => {
  // Structured product types: grain is Branch + Zone + Suite No (may be NULL) + Product Type.
  const structQ = STRUCTURED_TYPES.map(() => '?').join(',');
  const structuredCombos = db.prepare(`
    SELECT DISTINCT
      TRIM(Branch) AS branch,
      TRIM(Zone) AS zone,
      NULLIF(TRIM(COALESCE("Suite No", '')), '') AS suiteNo,
      TRIM("Material Type Desc.") AS productType
    FROM master_stock
    WHERE TRIM("Material Type Desc.") IN (${structQ})
  `).all(...STRUCTURED_TYPES);

  for (const c of structuredCombos) {
    const key = `${norm(c.branch)}|${norm(c.zone)}|${norm(c.suiteNo)}|${norm(c.productType)}`;
    if (existingStructuredKeys.has(key)) continue;
    insertBlank.run({ branch: c.branch, zone: c.zone, suiteNo: c.suiteNo, lotType: null, productType: c.productType });
    existingStructuredKeys.add(key);
    structuredInserted++;
  }

  // Flat-land product types: grain is Branch + Zone + Lot Type + Product Type. A handful of
  // rows (KL / NV Burial Plot / DOUBLE & FAMILY) have no Zone at all — zone_attributes.zone is
  // NOT NULL, so those are stored with zone = '' as a distinct "no zone assigned" placeholder
  // rather than being silently dropped.
  const flatQ = FLAT_TYPES.map(() => '?').join(',');
  const flatCombos = db.prepare(`
    SELECT DISTINCT
      TRIM(Branch) AS branch,
      TRIM(Zone) AS zone,
      TRIM("Lot Type") AS lotType,
      TRIM("Material Type Desc.") AS productType
    FROM master_stock
    WHERE TRIM("Material Type Desc.") IN (${flatQ})
  `).all(...FLAT_TYPES);

  for (const c of flatCombos) {
    if (UNIVERSAL_HIGH_LOT_TYPES.has(norm(c.lotType))) { flatSkippedUniversal++; continue; }
    const zone = c.zone ?? '';
    if (!c.zone) flatSkippedNullZone++; // still inserted, just tallied separately for the report
    const key = `${norm(c.branch)}|${norm(zone)}|${norm(c.lotType)}|${norm(c.productType)}`;
    if (existingFlatKeys.has(key)) continue;
    insertBlank.run({ branch: c.branch, zone, suiteNo: null, lotType: c.lotType, productType: c.productType });
    existingFlatKeys.add(key);
    flatInserted++;
  }
});
insertAll();

// ── After counts ──
const afterTotal = db.prepare(`SELECT COUNT(*) c FROM zone_attributes`).get().c;
const afterByType = countsByProductType();

console.log('\n--- Structured types (Branch+Zone+Suite No grain) ---');
console.log(`Inserted: ${structuredInserted} new blank placeholder rows.`);
console.log('\n--- Flat-land types (Branch+Zone+Lot Type grain) ---');
console.log(`Inserted: ${flatInserted} new blank placeholder rows.`);
console.log(`Skipped (universal SUPER FAMILY/ROYAL FAMILY lot type — covered by branch='ALL' rules): ${flatSkippedUniversal}`);
console.log(`Of those inserted, rows with no Zone in source data (stored as zone=''): ${flatSkippedNullZone}`);

console.log('\n--- BEFORE ---');
console.log(`Total: ${beforeTotal}`);
for (const r of beforeByType) console.log(`  ${r.product_type}: ${r.c} (tiered: ${r.tiered}, blank: ${r.blank})`);

console.log('\n--- AFTER ---');
console.log(`Total: ${afterTotal}`);
for (const r of afterByType) console.log(`  ${r.product_type}: ${r.c} (tiered: ${r.tiered}, blank: ${r.blank})`);

db.close();
