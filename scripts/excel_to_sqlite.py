import pandas as pd
import sqlite3
from datetime import datetime

print("Reading Excel file (this may take 30-60 seconds)...")
df = pd.read_excel(
    '/root/analyst/data/stock_data.xlsx',
    sheet_name='Master_Stock_Balance',
    engine='openpyxl'
)
print(f"Loaded {len(df)} rows, {len(df.columns)} columns")

# Source-system "Lot Type" spelling typos that recur on every monthly extract (not something
# fixable permanently in our database, since master_stock gets fully replaced by the next
# upload) — corrected here so every future load self-heals instead of needing a manual one-time
# SQL fix each month. Add further variants here if the source system introduces new ones.
LOT_TYPE_CORRECTIONS = {
    'TWIIN DOUBLE': 'TWIN DOUBLE',
    'ROYAL FAMLIY': 'ROYAL FAMILY',
}
if 'Lot Type' in df.columns:
    corrected = df['Lot Type'].isin(LOT_TYPE_CORRECTIONS.keys()).sum()
    if corrected:
        df['Lot Type'] = df['Lot Type'].replace(LOT_TYPE_CORRECTIONS)
        print(f"Normalized {corrected} row(s) with a known Lot Type spelling typo")

conn = sqlite3.connect('/root/analyst/data/stock.db')
df.to_sql('master_stock', conn, if_exists='replace', index=False)
# Only master_stock is ever replaced by a monthly update — every other table (monthly_snapshots,
# the attributes tables, etc.) persists across reloads. See routes/attributes.js's identical note.

# Monthly Trend snapshot — captures this update as one point in the Overview tab's trend line.
# CREATE TABLE IF NOT EXISTS so this script also works against a fresh stock.db with no prior
# snapshots. Keyed on the real-world calendar month the update is RUN in (not any date field
# inside the spreadsheet), so the trend reflects "when did we last update" — re-running this
# script for the same month (e.g. correcting a bad file) overwrites that month's row via INSERT OR
# REPLACE on the UNIQUE year_month key rather than duplicating it.
cur = conn.cursor()
cur.execute('''
    CREATE TABLE IF NOT EXISTS monthly_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_month TEXT NOT NULL UNIQUE,
      total_stock INTEGER,
      total_sold INTEGER,
      total_balance INTEGER,
      sell_through_pct REAL,
      balance_value REAL,
      captured_at TEXT DEFAULT (datetime('now'))
    )
''')

total_stock, total_sold, total_balance, balance_value = cur.execute('''
    SELECT
      SUM("Total Stock Case")     AS total_stock,
      SUM("Total Sold Case")      AS total_sold,
      SUM("Total Balance Case")   AS total_balance,
      SUM("Total Balance Amount") AS balance_value
    FROM master_stock
''').fetchone()
sell_through_pct = (total_sold / total_stock * 100) if total_stock else 0
year_month = datetime.now().strftime('%Y-%m')

cur.execute('''
    INSERT OR REPLACE INTO monthly_snapshots
      (year_month, total_stock, total_sold, total_balance, sell_through_pct, balance_value)
    VALUES (?, ?, ?, ?, ?, ?)
''', (year_month, total_stock, total_sold, total_balance, sell_through_pct, balance_value))
conn.commit()
print(f"Captured monthly snapshot for {year_month}: "
      f"stock={total_stock}, sold={total_sold}, balance={total_balance}, "
      f"sell-through={sell_through_pct:.2f}%, balance value={balance_value}")

# ── monthly_snapshots_detail: verified, snapshot-based Zone/Lot Type trend ──
# "Sales Date" is confirmed unreliable as a "when sold" indicator — it updates on ANY status
# change (ownership transfer, profile update, exercise, cancellation), not exclusively on sales,
# at any time. This table captures actual point-in-time inventory state per Branch + Product Type
# + Zone (and, for flat-land product types, + Lot Type too) at every monthly upload, so features
# like Lot Drill-Down's Verified Zone Trend can show real month-over-month change independent of
# Sales Date quality. Starts accumulating from this run forward — no backfill, since only the
# current month's data exists in master_stock at any time (prior months' raw Excel files aren't
# retained by this system).
cur.execute('''
    CREATE TABLE IF NOT EXISTS monthly_snapshots_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_month TEXT NOT NULL,
      branch TEXT NOT NULL,
      product_type TEXT NOT NULL,
      zone TEXT,
      lot_type TEXT,
      total_stock INTEGER,
      total_sold INTEGER,
      total_balance INTEGER,
      balance_value REAL,
      sell_through_pct REAL,
      captured_at TEXT DEFAULT (datetime('now')),
      UNIQUE(year_month, branch, product_type, zone, lot_type)
    )
''')
cur.execute('''
    CREATE INDEX IF NOT EXISTS idx_snapshot_detail_lookup
    ON monthly_snapshots_detail(branch, product_type, zone)
''')

# SQLite's UNIQUE constraint treats NULL columns (zone/lot_type here) as always-distinct from one
# another, so INSERT OR REPLACE alone won't dedupe a re-run for the same month (e.g. correcting a
# bad file) the way it does for monthly_snapshots' non-null year_month key above — clear this
# month's rows first so re-running this script stays idempotent.
cur.execute('DELETE FROM monthly_snapshots_detail WHERE year_month = ?', (year_month,))

# Flat-land product types only — consistent with this app's existing structured/flat convention
# (see routes/lifecycle.js's FLAT_TYPES). These are the only types that additionally get a second,
# Lot Type-grained set of rows on top of the core Branch+Product Type+Zone grain every product
# type gets.
FLAT_TYPES = ['NV Burial Plot', 'NV Seed', 'NV Urn Burial Plot', 'NV Pet Burial Plot']

def _clean_str(v):
    if pd.isna(v):
        return None
    s = str(v).strip()
    return s or None

def _insert_snapshot_detail(group_cols, snap_df):
    grouped = snap_df.groupby(group_cols, dropna=False).agg(
        total_stock=('Total Stock Case', 'sum'),
        total_sold=('Total Sold Case', 'sum'),
        total_balance=('Total Balance Case', 'sum'),
        balance_value=('Total Balance Amount', 'sum'),
    ).reset_index()

    inserted = 0
    for _, r in grouped.iterrows():
        branch = _clean_str(r['Branch'])
        product_type = _clean_str(r['Material Type Desc.'])
        if not branch or not product_type:
            continue
        zone = _clean_str(r['Zone']) if 'Zone' in group_cols else None
        lot_type = _clean_str(r['Lot Type']) if 'Lot Type' in group_cols else None
        # A blank Lot Type on a flat-land row adds nothing beyond the core zone-level row already
        # captured by the Branch+Product Type+Zone grouping, so it's skipped rather than stored
        # as its own row.
        if 'Lot Type' in group_cols and not lot_type:
            continue

        row_total_stock = int(r['total_stock']) if pd.notna(r['total_stock']) else 0
        row_total_sold = int(r['total_sold']) if pd.notna(r['total_sold']) else 0
        row_total_balance = int(r['total_balance']) if pd.notna(r['total_balance']) else 0
        row_balance_value = float(r['balance_value']) if pd.notna(r['balance_value']) else 0.0
        row_sell_through_pct = (row_total_sold / row_total_stock * 100) if row_total_stock else 0

        cur.execute('''
            INSERT OR REPLACE INTO monthly_snapshots_detail
              (year_month, branch, product_type, zone, lot_type,
               total_stock, total_sold, total_balance, balance_value, sell_through_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (year_month, branch, product_type, zone, lot_type,
              row_total_stock, row_total_sold, row_total_balance, row_balance_value, row_sell_through_pct))
        inserted += 1
    return inserted

zone_level_rows = _insert_snapshot_detail(['Branch', 'Material Type Desc.', 'Zone'], df)

lot_type_level_rows = 0
if 'Lot Type' in df.columns:
    flat_df = df[df['Material Type Desc.'].astype(str).str.strip().isin(FLAT_TYPES)]
    if len(flat_df):
        lot_type_level_rows = _insert_snapshot_detail(
            ['Branch', 'Material Type Desc.', 'Zone', 'Lot Type'], flat_df
        )

conn.commit()
print(f"Captured monthly_snapshots_detail for {year_month}: "
      f"{zone_level_rows} zone-level row(s), {lot_type_level_rows} lot-type-level row(s)")

conn.close()
print("Done — saved to data/stock.db")
