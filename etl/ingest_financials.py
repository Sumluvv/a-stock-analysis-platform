import os
import sys
import pandas as pd
from datetime import datetime
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

TS_TOKEN = os.getenv('TUSHARE_TOKEN')
pro = None
if TS_TOKEN:
    try:
        import tushare as ts
        pro = ts.pro_api(TS_TOKEN)
    except Exception:
        pro = None

def upsert_fin_metrics(ts_code: str, df: pd.DataFrame) -> int:
    rows = []
    for _, r in df.iterrows():
        period = pd.to_datetime(r['period']).date()
        # Map important metrics
        pairs = [
            ('revenue', r.get('revenue')),
            ('net_profit', r.get('n_income_attr_p')),
            ('eps', r.get('eps')),
            ('bps', r.get('bps')),  # 修复字段名
            ('operating_cf', r.get('n_cashflow_act')),
            ('roe', r.get('roe')),
            ('debt_to_asset', r.get('asset_liab_ratio')),
        ]
        for name, val in pairs:
            if pd.notna(val):
                rows.append((ts_code, period, name, float(val), None, 'tushare'))
    if not rows:
        return 0
    with psycopg.connect(**PG_DSN) as conn:
        with conn.cursor() as cur:
            sql = (
                "INSERT INTO fin_metrics (ts_code, report_period, metric_name, metric_value, unit, source) "
                "VALUES (%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (ts_code, report_period, metric_name) DO UPDATE SET metric_value=EXCLUDED.metric_value, unit=EXCLUDED.unit, source=EXCLUDED.source"
            )
            cur.executemany(sql, rows)
            conn.commit()
    return len(rows)

def ingest_tushare(ts_code: str, start_year: int = 2018) -> int:
    if pro is None:
        return 0
    out = 0
    # Use 'fina_indicator' and 'income' for broader coverage
    try:
        ind = pro.fina_indicator(ts_code=ts_code)
        if ind is not None and not ind.empty:
            # 选择需要的列，确保列存在
            available_cols = ['ts_code', 'end_date', 'eps', 'bps', 'roe', 'ocfps', 'debt_to_assets']
            selected_cols = [col for col in available_cols if col in ind.columns]
            ind = ind[selected_cols].rename(columns={'end_date':'period', 'ocfps':'n_cashflow_act', 'debt_to_assets':'asset_liab_ratio'})
            out += upsert_fin_metrics(ts_code, ind)
    except Exception as e:
        print(f"fina_indicator error: {e}")
        pass
    try:
        inc = pro.income(ts_code=ts_code, start_date=f"{start_year}0101")
        if inc is not None and not inc.empty:
            inc = inc[['ts_code','end_date','revenue','n_income_attr_p']].rename(columns={'end_date':'period'})
            out += upsert_fin_metrics(ts_code, inc)
    except Exception:
        pass
    return out

def ingest_akshare(ts_code: str) -> int:
    try:
        import akshare as ak
        code = ts_code.split('.')[0]
        total_upserts = 0

        # 1) 指标分析（含 EPS/BPS/ROE 等）
        try:
            ind = ak.stock_financial_analysis_indicator(symbol=code)
            # 可能包含 列: 报告期, 每股收益(元), 每股净资产(元), 净资产收益率(加权)(%), 经营活动产生的现金流量净额(元)
            if ind is not None and not ind.empty:
                rename_map = {
                    '报告期': 'period',
                    '每股收益(元)': 'eps',
                    '每股净资产(元)': 'bps',
                    '净资产收益率(加权)(%)': 'roe',
                    '经营活动产生的现金流量净额(元)': 'n_cashflow_act',
                }
                for k, v in rename_map.items():
                    if k in ind.columns:
                        ind.rename(columns={k: v}, inplace=True)
                if 'period' in ind.columns:
                    keep = ['period','eps','bps','roe','n_cashflow_act']
                    for k in keep:
                        if k not in ind.columns:
                            ind[k] = None
                    total_upserts += upsert_fin_metrics(ts_code, ind[keep])
        except Exception:
            pass

        # 2) 利润表（取 营业总收入、归母净利润）
        try:
            income = ak.stock_financial_report_sina(symbol=code, statement='利润表')
            # 常见列: 报告期, 营业总收入, 归属于母公司股东的净利润
            if income is not None and not income.empty:
                rename_map2 = {
                    '报告期': 'period',
                    '营业总收入': 'revenue',
                    '归属于母公司股东的净利润': 'n_income_attr_p',
                }
                for k, v in rename_map2.items():
                    if k in income.columns:
                        income.rename(columns={k: v}, inplace=True)
                if 'period' in income.columns:
                    keep2 = ['period','revenue','n_income_attr_p']
                    for k in keep2:
                        if k not in income.columns:
                            income[k] = None
                    total_upserts += upsert_fin_metrics(ts_code, income[keep2])
        except Exception:
            pass

        return total_upserts
    except Exception:
        return 0

if __name__ == '__main__':
    code = sys.argv[1] if len(sys.argv) > 1 else None
    if not code:
        print('Usage: python ingest_financials.py <ts_code>')
        sys.exit(1)
    count = 0
    if pro is not None:
        count += ingest_tushare(code)
    if count == 0:
        count += ingest_akshare(code)
    print(f'Upserted {count} financial metric rows for {code}')
