import os
import sys
import pandas as pd
try:
    import psycopg as psycopg
except Exception:
    import psycopg2 as psycopg
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

PG_DSN = {
    'host': os.getenv('PGHOST', 'localhost'),
    'port': int(os.getenv('PGPORT', '5432')),
    'dbname': os.getenv('PGDATABASE', 'infostream'),
    'user': os.getenv('PGUSER', 'infostream'),
    'password': os.getenv('PGPASSWORD', 'infostream'),
}

rows = []
ts_token = os.getenv('TUSHARE_TOKEN')
if ts_token:
    try:
        import tushare as ts
        pro = ts.pro_api(ts_token)
        # Fetch basic stock info (A-share)
        df = pro.stock_basic(
            exchange='', list_status='L',
            fields='ts_code,symbol,name,area,industry,fullname,market,exchange,list_date'
        )
        rows = [
            (
                row['ts_code'],
                row['name'],
                row.get('industry') or None,
                pd.to_datetime(row['list_date']).date() if row.get('list_date') else None,
                row.get('exchange') or None,
            )
            for _, row in df.iterrows()
        ]
    except Exception as e:
        print('Tushare path failed, falling back to AkShare:', e)

if not rows:
    try:
        import akshare as ak
        ak_df = None
        # Try common endpoints by AkShare versions
        for fn in (
            getattr(ak, 'stock_info_a_name_code', None),
            getattr(ak, 'stock_info_a_code_name', None),
        ):
            if fn is None:
                continue
            try:
                ak_df = fn()
                break
            except Exception:
                ak_df = None
        if ak_df is None or ak_df.empty:
            # Fallback: merge SH and SZ lists
            try:
                sh = ak.stock_info_sh_name_code()
                sz = ak.stock_info_sz_name_code()
                ak_df = pd.concat([sh, sz], ignore_index=True)
            except Exception:
                pass
        if ak_df is None or ak_df.empty:
            raise RuntimeError('AkShare endpoints returned empty')
        # Normalize columns
        if 'code' in ak_df.columns and 'name' in ak_df.columns:
            code_series = ak_df['code']
            name_series = ak_df['name']
        elif '证券代码' in ak_df.columns and '证券简称' in ak_df.columns:
            code_series = ak_df['证券代码']
            name_series = ak_df['证券简称']
        else:
            raise RuntimeError('Unexpected AkShare columns: ' + ','.join(ak_df.columns))
        rows = [
            (
                (f"{str(code)}.SH" if str(code).startswith('6') else f"{str(code)}.SZ"),
                str(name),
                None,
                None,
                ('SSE' if str(code).startswith('6') else 'SZSE')
            )
            for code, name in zip(code_series, name_series)
        ]
    except Exception as e:
        print('AkShare fallback failed:', e)
        sys.exit(1)

with psycopg.connect(**PG_DSN) as conn:
    with conn.cursor() as cur:
        sql = (
            "INSERT INTO dim_stock (ts_code, name, industry, list_date, exchange) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (ts_code) DO UPDATE SET "
            "name = EXCLUDED.name, "
            "industry = EXCLUDED.industry, "
            "list_date = COALESCE(dim_stock.list_date, EXCLUDED.list_date), "
            "exchange = EXCLUDED.exchange"
        )
        cur.executemany(sql, rows)
        conn.commit()

print(f'Upserted {len(rows)} stocks into dim_stock')
