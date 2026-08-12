// Detects two positional signals for NV Burial Plot lots — Wide Walkway and Gazebo/Center
// Proximity — inferred from lot-numbering and dimension patterns, not directly measured.
// Writes candidates to plot_position_signals for manual review in the Product Attributes tab
// (Positional Signals Beta section). Safe to re-run: INSERT OR IGNORE keyed on the UNIQUE
// material_no constraint means a re-run only adds newly-appeared candidates and never
// duplicates or resets review_status on rows already reviewed.
//
// Scope: only NV Burial Plot rows where Row is populated and not '00' — this excludes legacy
// zones (e.g. KL's EZ) that use a different numbering convention without a proper
// Row+sequential-number structure, confirmed in a previous session (see CLAUDE.md).
//
// --reset-gazebo: deletes existing Gazebo/Center Proximity rows before detecting (Wide Walkway
// rows are left untouched). Use this after a detection-rule change to the Gazebo logic, so
// candidates that no longer qualify are actually removed rather than just never
// re-inserted — plain re-runs never need this, since INSERT OR IGNORE already handles the
// "just pick up newly-appeared candidates" case safely.
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');
const RESET_GAZEBO = process.argv.includes('--reset-gazebo');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS plot_position_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_no TEXT NOT NULL UNIQUE,
    branch TEXT,
    zone TEXT,
    row TEXT,
    lot_number INTEGER,
    signal_type TEXT,
    evidence TEXT,
    current_price REAL,
    current_sell_through_pct REAL,
    review_status TEXT DEFAULT 'Pending',
    reviewed_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_plot_signals_lookup ON plot_position_signals(branch, zone, signal_type, review_status)`);

let resetCount = 0;
if (RESET_GAZEBO) {
  resetCount = db.prepare(`DELETE FROM plot_position_signals WHERE signal_type = 'Gazebo/Center Proximity'`).run().changes;
}

// Lot Dimension is stored "WIDTHxDEPTH" (same convention as routes/attributes.js's
// parseDimensionArea) — the second number is treated as "length" for the Wide Walkway check.
function parseDimension(dim) {
  if (!dim) return null;
  const m = String(dim).trim().match(/^([\d.]+)\s*[xX×]\s*([\d.]+)$/);
  if (!m) return null;
  const width = parseFloat(m[1]);
  const length = parseFloat(m[2]);
  if (!width || !length) return null;
  return { width, length };
}

// Material No format is typically "{batch}-{zone}-{row}{number}" (e.g. "05-GARDEN 1-DJ108").
// Rather than requiring the row prefix to match exactly (zone names can themselves contain
// dashes, e.g. "PSB-SBA1"), this just takes the trailing digit run of the last '-'-delimited
// segment, ignoring an optional trailing letter suffix (e.g. "DAA63A" -> 63).
function parseTrailingLotNumber(materialNo) {
  const lastSeg = String(materialNo).split('-').pop();
  const m = lastSeg.match(/(\d+)[A-Za-z]*$/);
  return m ? parseInt(m[1], 10) : null;
}

// "Most common" length = highest frequency; ties broken toward the smaller value, since the
// narrower plot is the more plausible "standard" and the wider one is the candidate to flag.
function modeLength(parsedRows) {
  const counts = new Map();
  for (const r of parsedRows) counts.set(r.d.length, (counts.get(r.d.length) || 0) + 1);
  let standard = null, bestCount = -1;
  for (const [len, c] of counts) {
    if (c > bestCount || (c === bestCount && len < standard)) { standard = len; bestCount = c; }
  }
  return standard;
}

// The observed lot-numbering scheme skips any number containing digit 4 or 5 in ANY decimal
// position (ones, tens, hundreds, ...) — not just the trailing digit. A raw numeric gap (e.g.
// 398→608) is therefore not on its own evidence of a physical break: most or all of it can be
// fully accounted for by that digit-avoidance convention.
function isValidNumber(n, avoidDigits) {
  const s = String(n);
  for (let i = 0; i < s.length; i++) if (avoidDigits.includes(Number(s[i]))) return false;
  return true;
}

// 64% of Branch+Zone+Row groups (1,676 of 2,617) actually number lots in steps of 10 with a
// FIXED last digit (e.g. row SE|D|SA runs ...388, 398, 608, 618... — every real lot ends in
// "8"), not plain consecutive integers. inferStep reads each row's OWN actual lot numbers to
// recover that real step size and fixed suffix directly from the data — no digit-avoidance
// assumption baked in here, that's applied separately in generateStepCandidates.
//
// hasPattern is only true with >=4 points AND a genuine multi-digit-position suffix (step >
// 1): a coincidental shared last digit across just 2-3 numbers is plausible by chance, and
// "every digit varies" (step=1, ordinary sequential numbering) isn't a *step* pattern in the
// sense this row-specific model is for — both cases route to the fallback heuristic instead of
// forcing a step model that doesn't actually describe the row (see findGazeboAnomaliesFallback).
function inferStep(nums) {
  if (nums.length < 4) return { hasPattern: false, step: 1, suffixNum: 0 };
  let k = 0;
  while (k < 4) {
    const mod = 10 ** (k + 1);
    const rem = nums[0] % mod;
    if (nums.every(n => n % mod === rem)) k++; else break;
  }
  return { hasPattern: k >= 1, step: 10 ** k, suffixNum: k > 0 ? nums[0] % (10 ** k) : 0 };
}

// Generates the row's own expected sequence between two actual lot numbers (every value on its
// detected step/suffix pattern), then filters it down to the ones digit-avoidance doesn't
// already explain away — what's left is genuinely unaccounted for under this row's real
// numbering convention.
function generateStepCandidates(a, b, step, suffixNum, avoidDigits) {
  const out = [];
  let start = Math.floor((a - suffixNum) / step) * step + suffixNum;
  if (start <= a) start += step;
  for (let v = start; v < b; v += step) if (isValidNumber(v, avoidDigits)) out.push(v);
  return out;
}

const GAZEBO_AVOID_DIGITS = [4, 5]; // the confirmed firm rule

// A single missing number is weak evidence on its own (routinely explained by one skipped/
// never-issued unit) — 87% of raw anomalous gaps are only 1 number short. Requiring at least 2
// keeps the stepped-path candidates focused on gaps with a real run of unexplained missing
// numbers.
const GAZEBO_MIN_MISSING = 2;

// ── Fallback heuristic (used when a row has no detected step pattern) ──
// The original relative-gap + absolute-floor rule, from before the digit-avoidance rebuild:
// requires a gap to clear BOTH bars — more than 4x the row's own median gap, AND at least 20
// numbers wide — since a purely relative bar over-flags rows with tight sequential numbering
// (median gap of 1-2), where a routine handful-of-numbers skip reads as "Nx typical" despite
// being trivially small.
const GAZEBO_MIN_ABS_GAP = 20;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sellThroughPct(stock, sold) {
  const s = Number(stock) || 0;
  if (s <= 0) return 0;
  return ((Number(sold) || 0) / s) * 100;
}

const allRows = db.prepare(`
  SELECT "Material No" AS materialNo, Branch AS branch, Zone AS zone, TRIM("Row") AS row,
         "Lot Dimension" AS dim, "Unit Price" AS price,
         "Total Stock Case" AS stock, "Total Sold Case" AS sold
  FROM master_stock
  WHERE "Material Type Desc." = 'NV Burial Plot'
`).all();

const inScope = allRows.filter(r => r.row && r.row !== '00');
const excluded = allRows.filter(r => !r.row || r.row === '00');
const excludedGroups = new Set(excluded.map(r => `${r.branch}|${r.zone}|${r.row || ''}`));

const groups = new Map();
for (const r of inScope) {
  const key = `${r.branch}|${r.zone}|${r.row}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

// Row-specific step-pattern path: for groups where inferStep found a genuine step/suffix
// convention. Generates that row's OWN expected sequence between each consecutive actual pair
// (via generateStepCandidates) rather than a generic every-integer or generic-digit-avoidance
// model, so a gap only counts if it skips values that should exist under THIS row's real
// pattern and don't.
function findGazeboAnomaliesStepped(numbered, step, suffixNum, onAnomaly) {
  for (let i = 1; i < numbered.length; i++) {
    const before = numbered[i - 1], after = numbered[i];
    if (after.lotNumber - before.lotNumber <= 1) continue; // nothing between them
    const missing = generateStepCandidates(before.lotNumber, after.lotNumber, step, suffixNum, GAZEBO_AVOID_DIGITS);
    if (missing.length < GAZEBO_MIN_MISSING) continue; // fully (or too weakly) explained — not a signal
    const evidence = `Gap ${before.lotNumber}→${after.lotNumber}: ${missing.length} valid lot number${missing.length === 1 ? '' : 's'} unexpectedly missing (e.g. ${missing.slice(0, 3).join(', ')})`;
    onAnomaly(before, after, evidence);
  }
}

// Fallback path: for groups where no step pattern was detected (too few points, or genuinely
// sequential numbering with no shared suffix) — the original relative-gap + absolute-floor
// heuristic, since forcing a step model onto a row that doesn't show one would misfire.
function findGazeboAnomaliesFallback(numbered, onAnomaly) {
  if (numbered.length < 4) return; // too few points for a meaningful median gap
  const gaps = [];
  for (let i = 1; i < numbered.length; i++) gaps.push(numbered[i].lotNumber - numbered[i - 1].lotNumber);
  const medianGap = median(gaps);
  if (medianGap <= 0) return; // no stable "typical gap" to compare against

  for (let i = 1; i < numbered.length; i++) {
    const before = numbered[i - 1], after = numbered[i];
    const gap = after.lotNumber - before.lotNumber;
    if (gap <= 4 * medianGap || gap < GAZEBO_MIN_ABS_GAP) continue;
    const multiple = (gap / medianGap).toFixed(1).replace(/\.0$/, '');
    const evidence = `Adjacent to lot-number gap: ${before.lotNumber}→${after.lotNumber} (${gap} skipped, ~${multiple}x row's typical gap)`;
    onAnomaly(before, after, evidence);
  }
}

// candidates: material_no -> { branch, zone, row, lotNumber, signalType, evidence, row data }.
// A material_no can only carry one signal (the table's UNIQUE constraint is on material_no
// alone) — Wide Walkway is evaluated first, so a lot flagged by both keeps its Wide Walkway
// record; overlap is rare (see reported count below).
const candidates = new Map();
let wideCount = 0, gazeboCount = 0, overlapCount = 0;
let gazeboGapCount = 0; // count of anomalous gaps (pairs), vs. gazeboCount which is lot-level
let steppedGroupCount = 0, fallbackGroupCount = 0;

// Reporting-only: tallies how many 398->608 consecutive pairs exist across all groups (the
// flagship example that motivated this rebuild) vs. how many actually got flagged by the main
// loop below — a step-pattern group should never flag it (fully explained by that row's own
// step + digit avoidance), so explained should track total minus the rare fallback-path
// exception.
let total398608 = 0, flagged398608 = 0, flaggedExample398608 = null;
for (const grp of groups.values()) {
  const numbered = grp.map(r => ({ r, lotNumber: parseTrailingLotNumber(r.materialNo) })).filter(x => x.lotNumber !== null);
  if (numbered.length < 2) continue;
  numbered.sort((a, b) => a.lotNumber - b.lotNumber || a.r.materialNo.localeCompare(b.r.materialNo));
  for (let i = 1; i < numbered.length; i++) {
    if (numbered[i - 1].lotNumber === 398 && numbered[i].lotNumber === 608) total398608++;
  }
}

for (const grp of groups.values()) {
  // ── Wide Walkway ──
  const dimRows = grp.map(r => ({ r, d: parseDimension(r.dim) })).filter(x => x.d);
  if (dimRows.length) {
    const standard = modeLength(dimRows);
    for (const { r, d } of dimRows) {
      if (d.length > standard + 3) {
        candidates.set(r.materialNo, {
          r, signalType: 'Wide Walkway',
          evidence: `Length ${d.length}ft vs row standard ${standard}ft (+${(d.length - standard).toFixed(1).replace(/\.0$/, '')}ft)`,
          lotNumber: parseTrailingLotNumber(r.materialNo),
        });
        wideCount++;
      }
    }
  }

  // ── Gazebo/Center Proximity ──
  const numbered = grp
    .map(r => ({ r, lotNumber: parseTrailingLotNumber(r.materialNo) }))
    .filter(x => x.lotNumber !== null);
  numbered.sort((a, b) => a.lotNumber - b.lotNumber || a.r.materialNo.localeCompare(b.r.materialNo));
  const { hasPattern, step, suffixNum } = inferStep([...new Set(numbered.map(x => x.lotNumber))]);
  if (hasPattern) steppedGroupCount++; else fallbackGroupCount++;

  const onAnomaly = (before, after, evidence) => {
    gazeboGapCount++;
    if (before.lotNumber === 398 && after.lotNumber === 608) {
      flagged398608++;
      if (!flaggedExample398608) flaggedExample398608 = { key: `${before.r.branch}|${before.r.zone}|${before.r.row}`, evidence };
    }
    for (const side of [before, after]) {
      if (!candidates.has(side.r.materialNo)) {
        candidates.set(side.r.materialNo, { r: side.r, signalType: 'Gazebo/Center Proximity', evidence, lotNumber: side.lotNumber });
        gazeboCount++;
      } else if (candidates.get(side.r.materialNo).signalType === 'Wide Walkway') {
        overlapCount++;
      }
    }
  };

  if (hasPattern) findGazeboAnomaliesStepped(numbered, step, suffixNum, onAnomaly);
  else findGazeboAnomaliesFallback(numbered, onAnomaly);
}

const insert = db.prepare(`
  INSERT OR IGNORE INTO plot_position_signals
    (material_no, branch, zone, row, lot_number, signal_type, evidence, current_price, current_sell_through_pct)
  VALUES (@materialNo, @branch, @zone, @row, @lotNumber, @signalType, @evidence, @price, @sellThroughPct)
`);

let insertedWide = 0, insertedGazebo = 0, skippedExisting = 0;
const insertMany = db.transaction((items) => {
  for (const c of items) {
    const result = insert.run({
      materialNo: c.r.materialNo, branch: c.r.branch, zone: c.r.zone, row: c.r.row,
      lotNumber: c.lotNumber, signalType: c.signalType, evidence: c.evidence,
      price: c.r.price, sellThroughPct: sellThroughPct(c.r.stock, c.r.sold),
    });
    if (result.changes) {
      if (c.signalType === 'Wide Walkway') insertedWide++; else insertedGazebo++;
    } else {
      skippedExisting++;
    }
  }
});
insertMany([...candidates.values()]);

// ── Report ──
console.log('=== Plot Position Signals Detection ===');
console.log(`NV Burial Plot rows total: ${allRows.length}`);
console.log(`In scope (Row populated, not '00'): ${inScope.length} rows across ${groups.size} Branch+Zone+Row groups`);
console.log(`Excluded (missing/legacy Row format): ${excluded.length} rows across ${excludedGroups.size} Branch+Zone+Row combos`);
console.log(`  Excluded combos: ${[...excludedGroups].join(', ')}`);
console.log('');
if (RESET_GAZEBO) console.log(`--reset-gazebo: deleted ${resetCount} existing Gazebo/Center Proximity rows before detecting.`);
console.log('');
console.log(`Wide Walkway candidates found this run: ${wideCount} (${insertedWide} newly inserted)`);
console.log(`Gazebo/Center Proximity candidates found this run: ${gazeboCount} lots across ${gazeboGapCount} anomalous gaps (${insertedGazebo} newly inserted)`);
console.log(`Overlap (qualified for both, kept as Wide Walkway): ${overlapCount}`);
console.log(`Skipped — already present from a previous run: ${skippedExisting}`);
console.log('');
console.log(`Groups using detected step pattern: ${steppedGroupCount} / ${groups.size}`);
console.log(`Groups using fallback (relative-gap + absolute-floor) heuristic: ${fallbackGroupCount} / ${groups.size}`);
console.log('');
console.log('398→608-style gap: ' + total398608 + ' occurrences across all groups');
console.log(`  Explained (not flagged): ${total398608 - flagged398608}`);
console.log(`  Still flagged: ${flagged398608}${flaggedExample398608 ? ` — e.g. ${flaggedExample398608.key}: ${flaggedExample398608.evidence}` : ''}`);
console.log('');

const totalByType = db.prepare(`SELECT signal_type, review_status, COUNT(*) c FROM plot_position_signals GROUP BY signal_type, review_status`).all();
console.log('Current table totals by signal type / review status:');
for (const row of totalByType) console.log(`  ${row.signal_type} / ${row.review_status}: ${row.c}`);
console.log('');

function sample(signalType, n = 5) {
  return db.prepare(`
    SELECT material_no, branch, zone, row, lot_number, evidence, current_price, current_sell_through_pct
    FROM plot_position_signals WHERE signal_type = ? ORDER BY id LIMIT ?
  `).all(signalType, n);
}
console.log('--- 5 sample Wide Walkway candidates ---');
console.table(sample('Wide Walkway'));
console.log('--- 5 sample Gazebo/Center Proximity candidates ---');
console.table(sample('Gazebo/Center Proximity'));

db.close();
