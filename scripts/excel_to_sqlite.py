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

conn.close()
print("Done — saved to data/stock.db")
