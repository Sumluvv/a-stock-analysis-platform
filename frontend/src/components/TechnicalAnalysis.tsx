// 技术分析组件
// frontend/src/components/TechnicalAnalysis.tsx

import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, BarChart3 } from 'lucide-react';

interface TechnicalIndicators {
  ma5: number;
  ma10: number;
  ma20: number;
  ma60: number;
  ema12: number;
  ema26: number;
  rsi: number;
  macd: number;
  macd_signal: number;
  macd_histogram: number;
  bollinger_upper: number;
  bollinger_middle: number;
  bollinger_lower: number;
  bollinger_width: number;
  obv: number;
  volume_ma5: number;
  volume_ma10: number;
  kdj_k: number;
  kdj_d: number;
  kdj_j: number;
  cci: number;
  williams_r: number;
  atr: number;
}

interface TechnicalSignals {
  trend: 'bullish' | 'bearish' | 'neutral';
  momentum: 'strong' | 'weak' | 'neutral';
  volatility: 'high' | 'low' | 'normal';
  signals: string[];
}

interface TechnicalAnalysisProps {
  tsCode: string;
  className?: string;
}

export const TechnicalAnalysis: React.FC<TechnicalAnalysisProps> = ({ 
  tsCode, 
  className = '' 
}) => {
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [signals, setSignals] = useState<TechnicalSignals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTechnicalData = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/technical/indicators/${tsCode}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch technical data');
        }
        
        const data = await response.json();
        setIndicators(data.indicators);
        setSignals(data.signals);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    if (tsCode) {
      fetchTechnicalData();
    }
  }, [tsCode]);

  if (loading) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="text-center text-red-600">
          <Activity className="h-8 w-8 mx-auto mb-2" />
          <p>技术分析加载失败</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!indicators || !signals) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="text-center text-gray-500">
          <BarChart3 className="h-8 w-8 mx-auto mb-2" />
          <p>暂无技术分析数据</p>
        </div>
      </div>
    );
  }

  const getTrendIcon = () => {
    switch (signals.trend) {
      case 'bullish':
        return <TrendingUp className="h-5 w-5 text-green-600" />;
      case 'bearish':
        return <TrendingDown className="h-5 w-5 text-red-600" />;
      default:
        return <Activity className="h-5 w-5 text-gray-600" />;
    }
  };

  const getTrendColor = () => {
    switch (signals.trend) {
      case 'bullish':
        return 'text-green-600';
      case 'bearish':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getMomentumColor = () => {
    switch (signals.momentum) {
      case 'strong':
        return 'text-green-600';
      case 'weak':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">技术分析</h3>
        <div className="flex items-center space-x-2">
          {getTrendIcon()}
          <span className={`font-medium ${getTrendColor()}`}>
            {signals.trend === 'bullish' ? '看涨' : signals.trend === 'bearish' ? '看跌' : '中性'}
          </span>
        </div>
      </div>

      {/* 关键指标 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-sm text-gray-600 mb-1">RSI</div>
          <div className={`text-lg font-semibold ${
            indicators.rsi > 70 ? 'text-red-600' : 
            indicators.rsi < 30 ? 'text-green-600' : 
            'text-gray-900'
          }`}>
            {indicators.rsi.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">
            {indicators.rsi > 70 ? '超买' : indicators.rsi < 30 ? '超卖' : '正常'}
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-sm text-gray-600 mb-1">MACD</div>
          <div className={`text-lg font-semibold ${
            indicators.macd > indicators.macd_signal ? 'text-green-600' : 'text-red-600'
          }`}>
            {indicators.macd.toFixed(3)}
          </div>
          <div className="text-xs text-gray-500">
            {indicators.macd > indicators.macd_signal ? '金叉' : '死叉'}
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-sm text-gray-600 mb-1">KDJ-K</div>
          <div className={`text-lg font-semibold ${
            indicators.kdj_k > 80 ? 'text-red-600' : 
            indicators.kdj_k < 20 ? 'text-green-600' : 
            'text-gray-900'
          }`}>
            {indicators.kdj_k.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">
            {indicators.kdj_k > 80 ? '超买' : indicators.kdj_k < 20 ? '超卖' : '正常'}
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-sm text-gray-600 mb-1">CCI</div>
          <div className={`text-lg font-semibold ${
            indicators.cci > 100 ? 'text-red-600' : 
            indicators.cci < -100 ? 'text-green-600' : 
            'text-gray-900'
          }`}>
            {indicators.cci.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">
            {indicators.cci > 100 ? '超买' : indicators.cci < -100 ? '超卖' : '正常'}
          </div>
        </div>
      </div>

      {/* 均线系统 */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">均线系统</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-xs text-gray-500">MA5</div>
            <div className="text-sm font-medium">{indicators.ma5.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">MA10</div>
            <div className="text-sm font-medium">{indicators.ma10.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">MA20</div>
            <div className="text-sm font-medium">{indicators.ma20.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">MA60</div>
            <div className="text-sm font-medium">{indicators.ma60.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* 布林带 */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">布林带</h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-xs text-gray-500">上轨</div>
            <div className="text-sm font-medium text-red-600">{indicators.bollinger_upper.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">中轨</div>
            <div className="text-sm font-medium text-gray-900">{indicators.bollinger_middle.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">下轨</div>
            <div className="text-sm font-medium text-green-600">{indicators.bollinger_lower.toFixed(2)}</div>
          </div>
        </div>
        <div className="text-center mt-2">
          <div className="text-xs text-gray-500">带宽</div>
          <div className={`text-sm font-medium ${
            indicators.bollinger_width > 0.1 ? 'text-orange-600' : 
            indicators.bollinger_width < 0.05 ? 'text-blue-600' : 
            'text-gray-900'
          }`}>
            {(indicators.bollinger_width * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 技术信号 */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">技术信号</h4>
        <div className="space-y-2">
          {signals.signals.map((signal, index) => (
            <div key={index} className="flex items-center space-x-2 text-sm">
              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
              <span className="text-gray-700">{signal}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 动量状态 */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-2">
          <span className="text-gray-600">动量:</span>
          <span className={`font-medium ${getMomentumColor()}`}>
            {signals.momentum === 'strong' ? '强劲' : signals.momentum === 'weak' ? '疲弱' : '中性'}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-gray-600">波动率:</span>
          <span className={`font-medium ${
            signals.volatility === 'high' ? 'text-orange-600' : 
            signals.volatility === 'low' ? 'text-blue-600' : 
            'text-gray-900'
          }`}>
            {signals.volatility === 'high' ? '较高' : signals.volatility === 'low' ? '较低' : '正常'}
          </span>
        </div>
      </div>
    </div>
  );
};



