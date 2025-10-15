// 成本监控仪表板组件
// frontend/src/components/CostMonitorDashboard.tsx

import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  Activity,
  BarChart3,
  PieChart,
  Clock
} from 'lucide-react';

interface CostMetrics {
  total_cost: number;
  daily_cost: number;
  monthly_cost: number;
  ai_cost: number;
  api_cost: number;
  breakdown: {
    by_service: Record<string, number>;
    by_user: Record<string, number>;
    by_endpoint: Record<string, number>;
  };
  trends: {
    daily: Array<{ date: string; cost: number }>;
    hourly: Array<{ hour: string; cost: number }>;
  };
  alerts: Array<{
    type: string;
    message: string;
    severity: string;
    timestamp: string;
  }>;
}

interface CostForecast {
  predicted_daily_cost: number;
  predicted_monthly_cost: number;
  confidence: number;
  factors: string[];
}

interface CostMonitorDashboardProps {
  className?: string;
}

export const CostMonitorDashboard: React.FC<CostMonitorDashboardProps> = ({ 
  className = '' 
}) => {
  const [metrics, setMetrics] = useState<CostMetrics | null>(null);
  const [forecast, setForecast] = useState<CostForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<number>(30);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        const [metricsResponse, forecastResponse] = await Promise.all([
          fetch(`/api/monitoring/cost-metrics?days=${timeRange}`),
          fetch('/api/monitoring/cost-forecast')
        ]);
        
        if (metricsResponse.ok) {
          const metricsData = await metricsResponse.json();
          setMetrics(metricsData);
        }
        
        if (forecastResponse.ok) {
          const forecastData = await forecastResponse.json();
          setForecast(forecastData);
        }
        
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [timeRange]);

  const formatCurrency = (amount: number) => {
    return `¥${amount.toFixed(2)}`;
  };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'medium':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high':
        return <AlertTriangle className="h-4 w-4" />;
      case 'medium':
        return <Activity className="h-4 w-4" />;
      case 'low':
        return <Clock className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="text-center text-red-600">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>加载失败</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="text-center text-gray-500">
          <BarChart3 className="h-8 w-8 mx-auto mb-2" />
          <p>暂无成本数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">成本监控仪表板</h2>
        <div className="flex items-center space-x-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm"
          >
            <option value={7}>最近7天</option>
            <option value={30}>最近30天</option>
            <option value={90}>最近90天</option>
          </select>
        </div>
      </div>

      {/* 成本概览 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-blue-600 font-medium">总成本</p>
              <p className="text-2xl font-bold text-blue-900">
                {formatCurrency(metrics.total_cost)}
              </p>
            </div>
            <DollarSign className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-green-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-600 font-medium">日成本</p>
              <p className="text-2xl font-bold text-green-900">
                {formatCurrency(metrics.daily_cost)}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div className="bg-purple-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-purple-600 font-medium">月成本</p>
              <p className="text-2xl font-bold text-purple-900">
                {formatCurrency(metrics.monthly_cost)}
              </p>
            </div>
            <BarChart3 className="h-8 w-8 text-purple-600" />
          </div>
        </div>

        <div className="bg-orange-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-orange-600 font-medium">AI成本</p>
              <p className="text-2xl font-bold text-orange-900">
                {formatCurrency(metrics.ai_cost)}
              </p>
            </div>
            <Activity className="h-8 w-8 text-orange-600" />
          </div>
        </div>
      </div>

      {/* 成本预测 */}
      {forecast && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-medium text-gray-900 mb-3">成本预测</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">预测日成本</p>
              <p className="text-xl font-semibold text-gray-900">
                {formatCurrency(forecast.predicted_daily_cost)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">预测月成本</p>
              <p className="text-xl font-semibold text-gray-900">
                {formatCurrency(forecast.predicted_monthly_cost)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">预测置信度</p>
              <p className="text-xl font-semibold text-gray-900">
                {formatPercentage(forecast.confidence)}
              </p>
            </div>
          </div>
          {forecast.factors.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-gray-600 mb-1">影响因素：</p>
              <ul className="text-sm text-gray-700">
                {forecast.factors.map((factor, index) => (
                  <li key={index} className="flex items-center space-x-1">
                    <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 成本分解 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 按服务分解 */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">按服务分解</h3>
          <div className="space-y-2">
            {Object.entries(metrics.breakdown.by_service).map(([service, cost]) => (
              <div key={service} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <span className="font-medium text-gray-900 capitalize">{service}</span>
                <span className="text-gray-600">{formatCurrency(cost)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 按端点分解 */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">按端点分解</h3>
          <div className="space-y-2">
            {Object.entries(metrics.breakdown.by_endpoint).slice(0, 5).map(([endpoint, cost]) => (
              <div key={endpoint} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <span className="font-medium text-gray-900 text-sm truncate">{endpoint}</span>
                <span className="text-gray-600">{formatCurrency(cost)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 成本趋势 */}
      <div className="mb-6">
        <h3 className="text-lg font-medium text-gray-900 mb-3">成本趋势</h3>
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-7 gap-2">
            {metrics.trends.daily.slice(0, 7).map((day, index) => {
              const maxCost = Math.max(...metrics.trends.daily.map(d => d.cost));
              const height = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
              
              return (
                <div key={index} className="text-center">
                  <div className="bg-blue-200 rounded-t" style={{ height: `${height}px` }}>
                    <div className="text-xs text-blue-600 mt-1">
                      {formatCurrency(day.cost)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {new Date(day.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 告警 */}
      {metrics.alerts.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">最近告警</h3>
          <div className="space-y-2">
            {metrics.alerts.map((alert, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${getSeverityColor(alert.severity)}`}
              >
                <div className="flex items-start space-x-2">
                  {getSeverityIcon(alert.severity)}
                  <div className="flex-1">
                    <p className="font-medium">{alert.message}</p>
                    <p className="text-sm opacity-75">
                      {new Date(alert.timestamp).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};



