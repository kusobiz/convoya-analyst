import pandas as pd
import sqlite3

print("Reading Excel file (this may take 30-60 seconds)...")
df = pd.read_excel(
    '/root/analyst/data/stock_data.xlsx',
    sheet_name='Master_Stock_Balance',
    engine='openpyxl'
)
print(f"Loaded {len(df)} rows, {len(df.columns)} columns")

conn = sqlite3.connect('/root/analyst/data/stock.db')
df.to_sql('master_stock', conn, if_exists='replace', index=False)
conn.close()
print("Done — saved to data/stock.db")
