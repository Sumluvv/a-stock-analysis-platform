// 股票榜单组件
// frontend/src/components/SmartRankingCard.tsx

import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, BarChart3 } from 'lucide-react';
import { api } from '../utils/api';

interface StockRankingItem {
  ts_code: string;
  name: string;
  industry: string;
  exchange: string;
  trade_date: string;
  close: number;
  pct_chg: number;
  vol: number;
  amount: number;
  turnover_rate: number;
  volume_ratio: number;
  total_mv: number;
  circ_mv: number;
  hot_score: number;
}

interface RankingData {
  items: StockRankingItem[];
}

interface RankingCardProps {
  title: string;
  endpoint: string;
  className?: string;
  showMarketCondition?: boolean;
}

export const SmartRankingCard: React.FC<RankingCardProps> = ({
  title,
  endpoint,
  className = '',
  showMarketCondition = false
}) => {
  const [data, setData] = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get(`/feeds/rankings/${endpoint}?limit=3`);
        const result = response.data; // 直接使用 response.data，不需要 .json()
        const normalizedItems = result.items.map((item: any) => ({
          ...item,
          close: Number(item.close),
          pct_chg: Number(item.pct_chg),
          vol: Number(item.vol),
          amount: Number(item.amount),
          turnover_rate: Number(item.turnover_rate),
          volume_ratio: Number(item.volume_ratio),
          total_mv: Number(item.total_mv),
          circ_mv: Number(item.circ_mv),
          hot_score: Number(item.hot_score),
        }));
        setData({ ...result, items: normalizedItems });
      } catch (err: any) {
        setError(err?.message || '加载失败');
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [endpoint]);

  const formatNumber = (num: number, type: 'price' | 'percent' | 'volume' | 'amount' | 'rate') => {
    if (isNaN(num)) return '--';
    
    switch (type) {
      case 'price':
        return num.toFixed(2);
      case 'percent':
        return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
      case 'volume':
        if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
        return num.toFixed(0);
      case 'amount':
        if (num >= 100000000) return `${(num / 100000000).toFixed(1)}亿`;
        if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
        return num.toFixed(0);
      case 'rate':
        return `${num.toFixed(2)}%`;
      default:
        return num.toFixed(2);
    }
  };

  const getIcon = () => {
    switch (endpoint) {
      case 'first-limit':
        return <TrendingUp className="h-5 w-5 text-red-500" />;
      case 'max-gain':
        return <TrendingUp className="h-5 w-5 text-green-500" />;
      case 'volume':
        return <Activity className="h-5 w-5 text-blue-500" />;
      case 'amount':
        return <BarChart3 className="h-5 w-5 text-purple-500" />;
      default:
        return <TrendingUp className="h-5 w-5 text-gray-500" />;
    }
  };

  const getValueDisplay = (item: StockRankingItem) => {
    switch (endpoint) {
      case 'first-limit':
      case 'max-gain':
        return formatNumber(item.pct_chg, 'percent');
      case 'volume':
        return formatNumber(item.vol, 'volume');
      case 'amount':
        return formatNumber(item.amount, 'amount');
      default:
        return '--';
    }
  };

  if (loading) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="flex items-center space-x-2 mb-4">
          {getIcon()}
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="flex items-center space-x-2 mb-4">
          {getIcon()}
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="text-center text-gray-500 py-4">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
      <div className="flex items-center space-x-2 mb-4">
        {getIcon()}
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      
      <div className="space-y-3">
        {data?.items?.length > 0 ? (
          data.items.map((item, index) => (
            <div key={item.ts_code} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600">#{index + 1}</span>
                  <span className="text-sm font-semibold text-gray-900">{item.name}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {item.ts_code} · {item.industry}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-gray-900">
                  {getValueDisplay(item)}
                </div>
                <div className="text-xs text-gray-500">
                  {formatNumber(item.close, 'price')}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center text-gray-500 py-4">
            <p className="text-sm">暂无数据</p>
          </div>
        )}
      </div>
    </div>
  );
};