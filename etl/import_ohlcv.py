import os
import sys
import time
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

ts_token = os.getenv('TUSHARE_TOKEN')
pro = None
if ts_token:
    try:
        import tushare as ts
        pro = ts.pro_api(ts_token)
    except Exception as e:
        print('Tushare init failed, will try AkShare:', e)

def fetch_and_insert(ts_code: str, start_date: str = '20220101', end_date: str = None):
    df = None
    if pro is not None:
        params = dict(ts_code=ts_code, start_date=start_date)
        if end_date:
            params['end_date'] = end_date
        try:
            df = pro.daily(**params)
        except Exception as e:
            print('Tushare daily failed, will try AkShare:', e)
            df = None
    if df is None or df.empty:
        try:
            import akshare as ak
            code = ts_code.split('.')[0]
            # AkShare expects YYYYMMDD, ensure format
            ak_df = ak.stock_zh_a_hist(symbol=code, period='daily', start_date=start_date, adjust='')
            ak_df.rename(columns={
                '日期': 'trade_date', '开盘': 'open', '最高': 'high', '最低': 'low', '收盘': 'close', '成交量': 'vol', '成交额': 'amount'
            }, inplace=True)
            df = ak_df
        except Exception as e:
            print('AkShare fetch failed:', e)
            return 0
    if df is None or df.empty:
        return 0
    df['trade_date'] = pd.to_datetime(df['trade_date'])
    if 'pre_close' not in df.columns:
        df['pre_close'] = pd.NA
    if 'change' not in df.columns:
        df['change'] = pd.NA
    if 'pct_chg' not in df.columns:
        df['pct_chg'] = pd.NA
    rows = [
        (
            ts_code,
            pd.to_datetime(r.get('trade_date')).date(),
            float(r.get('open')) if pd.notna(r.get('open')) else None,
            float(r.get('high')) if pd.notna(r.get('high')) else None,
            float(r.get('low')) if pd.notna(r.get('low')) else None,
            float(r.get('close')) if pd.notna(r.get('close')) else None,
            float(r.get('pre_close')) if pd.notna(r.get('pre_close')) else None,
            float(r.get('change')) if pd.notna(r.get('change')) else None,
            float(r.get('pct_chg')) if pd.notna(r.get('pct_chg')) else None,
            float(r.get('vol')) if pd.notna(r.get('vol')) else None,
            float(r.get('amount')) if pd.notna(r.get('amount')) else None,
            'D'
        )
        for r in df.to_dict('records')
    ]
    if not rows:
        return 0
    with psycopg.connect(**PG_DSN) as conn:
        with conn.cursor() as cur:
            sql = (
                "INSERT INTO prices_ohlcv (ts_code, trade_date, open, high, low, close, pre_close, change, pct_chg, vol, amount, freq) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (ts_code, trade_date, freq) DO UPDATE SET "
                "open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close, "
                "pre_close = EXCLUDED.pre_close, change = EXCLUDED.change, pct_chg = EXCLUDED.pct_chg, vol = EXCLUDED.vol, amount = EXCLUDED.amount"
            )
            cur.executemany(sql, rows)
            conn.commit()
    return len(rows)

if __name__ == '__main__':
    ts_code = sys.argv[1] if len(sys.argv) > 1 else None
    if not ts_code:
        print('Usage: python import_ohlcv.py <ts_code> [start_dateYYYYMMDD] [end_dateYYYYMMDD]')
        sys.exit(1)
    start_date = sys.argv[2] if len(sys.argv) > 2 else '20220101'
    end_date = sys.argv[3] if len(sys.argv) > 3 else None
    inserted = fetch_and_insert(ts_code, start_date, end_date)
    print(f'Inserted/updated {inserted} rows for {ts_code}')
