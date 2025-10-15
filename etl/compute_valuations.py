#!/usr/bin/env python3
"""
估值计算脚本 - 计算PE/PB等估值指标
"""

import os
import sys
import psycopg
import json
from datetime import datetime, date
from decimal import Decimal
import logging

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_db_connection():
    """获取数据库连接"""
    return psycopg.connect(
        host=os.getenv('PGHOST', 'localhost'),
        port=os.getenv('PGPORT', '5432'),
        dbname=os.getenv('PGDATABASE', 'infostream'),
        user=os.getenv('PGUSER', 'infostream'),
        password=os.getenv('PGPASSWORD', 'infostream')
    )

def get_latest_price(conn, ts_code):
    """获取最新股价"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT close, trade_date 
            FROM prices_ohlcv 
            WHERE ts_code = %s 
            ORDER BY trade_date DESC 
            LIMIT 1
        """, (ts_code,))
        result = cur.fetchone()
        return float(result[0]) if result and result[0] else None

def get_latest_financials(conn, ts_code):
    """获取最新财务数据"""
    with conn.cursor() as cur:
        # 获取最新EPS和BPS
        cur.execute("""
            SELECT 
                MAX(CASE WHEN metric_name = 'eps' THEN metric_value END) as eps,
                MAX(CASE WHEN metric_name = 'bps' THEN metric_value END) as bps,
                MAX(CASE WHEN metric_name = 'roe' THEN metric_value END) as roe,
                MAX(CASE WHEN metric_name = 'revenue' THEN metric_value END) as revenue,
                MAX(CASE WHEN metric_name = 'net_profit' THEN metric_value END) as net_profit,
                MAX(report_period) as latest_period
            FROM fin_metrics 
            WHERE ts_code = %s 
            AND metric_name IN ('eps', 'bps', 'roe', 'revenue', 'net_profit')
        """, (ts_code,))
        
        result = cur.fetchone()
        if result and result[0]:  # 确保有EPS数据
            return {
                'eps': float(result[0]) if result[0] else None,
                'bps': float(result[1]) if result[1] else None,
                'roe': float(result[2]) if result[2] else None,
                'revenue': float(result[3]) if result[3] else None,
                'net_profit': float(result[4]) if result[4] else None,
                'latest_period': result[5]
            }
        return None

def calculate_valuations(price, financials):
    """计算估值指标"""
    if not price or not financials or not financials.get('eps'):
        return None
    
    eps = financials['eps']
    bps = financials.get('bps')
    
    valuations = {
        'pe_ratio': float(price / eps) if eps > 0 else None,
        'pb_ratio': float(price / bps) if bps and bps > 0 else None,
        'market_cap': None,  # 需要股本数据
        'pe_ttm': None,      # 需要TTM EPS
        'pb_ttm': None       # 需要TTM BPS
    }
    
    return valuations

def upsert_valuation(conn, ts_code, valuations, financials, price):
    """存储估值数据"""
    with conn.cursor() as cur:
        # 检查是否已存在
        cur.execute("""
            SELECT id FROM valuations 
            WHERE ts_code = %s AND as_of_date = CURRENT_DATE AND method = 'pe_pb'
        """, (ts_code,))
        
        existing = cur.fetchone()
        
        # 准备输入和结果JSON
        input_data = {
            'current_price': price,
            'eps': financials.get('eps'),
            'bps': financials.get('bps'),
            'roe': financials.get('roe'),
            'revenue': financials.get('revenue'),
            'net_profit': financials.get('net_profit')
        }
        
        result_data = {
            'pe_ratio': valuations['pe_ratio'],
            'pb_ratio': valuations['pb_ratio'],
            'pe_implied_price': valuations['pe_ratio'] * financials.get('eps') if financials.get('eps') else None,
            'pb_implied_price': valuations['pb_ratio'] * financials.get('bps') if financials.get('bps') else None
        }
        
        if existing:
            # 更新现有记录
            cur.execute("""
                UPDATE valuations SET
                    input_json = %s::jsonb,
                    result_json = %s::jsonb,
                    pe_implied_price = %s,
                    pb_implied_price = %s
                WHERE ts_code = %s AND as_of_date = CURRENT_DATE AND method = 'pe_pb'
            """, (
                json.dumps(input_data),
                json.dumps(result_data),
                result_data['pe_implied_price'],
                result_data['pb_implied_price'],
                ts_code
            ))
        else:
            # 插入新记录
            cur.execute("""
                INSERT INTO valuations (
                    ts_code, as_of_date, method, input_json, result_json,
                    pe_implied_price, pb_implied_price, created_at
                ) VALUES (
                    %s, CURRENT_DATE, 'pe_pb', %s::jsonb, %s::jsonb, %s, %s, NOW()
                )
            """, (
                ts_code,
                json.dumps(input_data),
                json.dumps(result_data),
                result_data['pe_implied_price'],
                result_data['pb_implied_price']
            ))
        
        conn.commit()
        logger.info(f"✅ 估值数据已更新: {ts_code}")

def compute_valuation(ts_code):
    """计算单只股票的估值"""
    logger.info(f"🔄 开始计算 {ts_code} 的估值...")
    
    try:
        with get_db_connection() as conn:
            # 获取最新股价
            price = get_latest_price(conn, ts_code)
            if not price:
                logger.warning(f"❌ 未找到 {ts_code} 的价格数据")
                return False
            
            # 获取最新财务数据
            financials = get_latest_financials(conn, ts_code)
            if not financials:
                logger.warning(f"❌ 未找到 {ts_code} 的财务数据")
                return False
            
            # 计算估值
            valuations = calculate_valuations(price, financials)
            if not valuations:
                logger.warning(f"❌ 无法计算 {ts_code} 的估值")
                return False
            
            # 存储估值数据
            upsert_valuation(conn, ts_code, valuations, financials, price)
            
            # 输出结果
            logger.info(f"📊 {ts_code} 估值结果:")
            logger.info(f"   当前价格: ¥{price:.2f}")
            logger.info(f"   EPS: {financials['eps']:.2f}")
            logger.info(f"   BPS: {financials.get('bps', 'N/A')}")
            logger.info(f"   PE: {valuations['pe_ratio']:.2f}" if valuations['pe_ratio'] else "   PE: N/A")
            logger.info(f"   PB: {valuations['pb_ratio']:.2f}" if valuations['pb_ratio'] else "   PB: N/A")
            
            return True
            
    except Exception as e:
        logger.error(f"❌ 计算 {ts_code} 估值时出错: {e}")
        return False

def main():
    """主函数"""
    if len(sys.argv) != 2:
        print("用法: python compute_valuations.py <ts_code>")
        print("示例: python compute_valuations.py 600519.SH")
        sys.exit(1)
    
    ts_code = sys.argv[1]
    
    # 加载环境变量
    from dotenv import load_dotenv
    load_dotenv()
    
    logger.info(f"🚀 开始估值计算: {ts_code}")
    
    success = compute_valuation(ts_code)
    
    if success:
        logger.info(f"✅ {ts_code} 估值计算完成")
    else:
        logger.error(f"❌ {ts_code} 估值计算失败")
        sys.exit(1)

if __name__ == "__main__":
    main()
