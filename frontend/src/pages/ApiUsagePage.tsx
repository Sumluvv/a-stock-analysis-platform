// API使用统计页面
// frontend/src/pages/ApiUsagePage.tsx

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Layout } from '../components/Layout';
import { 
  Activity, 
  TrendingUp, 
  DollarSign, 
  Clock, 
  CheckCircle, 
  XCircle,
  BarChart3,
  Calendar
} from 'lucide-react';

interface UsageStats {
  total_requests: number;
  total_tokens: number;
  total_cost: number;
  by_provider: Record<string, any>;
  daily_breakdown: Array<{
    date: string;
    requests: number;
    tokens: number;
    cost: number;
  }>;
}

interface ApiKey {
  id: string;
  user_id: string;
  provider: string;
  display_name: string;
  usage_limit: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const ApiUsagePage: React.FC = () => {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState(30);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [statsResponse, keysResponse] = await Promise.all([
          api.get(`/external/usage-stats?days=${selectedDays}`),
          api.get('/external/api-keys')
        ]);

        setStats(statsResponse.data);
        setApiKeys(keysResponse.data.api_keys || []);
      } catch (err: any) {
        setError(err.response?.data?.message || '获取数据失败');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedDays]);

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(4)}`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'gemini_pro':
        return <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center text-white text-sm font-bold">G</div>;
      case 'openai_plus':
        return <div className="w-8 h-8 bg-green-500 rounded flex items-center justify-center text-white text-sm font-bold">O</div>;
      case 'claude_pro':
        return <div className="w-8 h-8 bg-purple-500 rounded flex items-center justify-center text-white text-sm font-bold">C</div>;
      default:
        return <div className="w-8 h-8 bg-gray-500 rounded flex items-center justify-center text-white text-sm font-bold">?</div>;
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-red-600">
            <XCircle className="h-12 w-12 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">加载失败</h2>
            <p>{error}</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">API使用统计</h1>
          <p className="text-gray-600">
            查看您的外部API使用情况和成本统计
          </p>
        </div>

        {/* 时间范围选择 */}
        <div className="mb-6">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-gray-700">统计时间范围:</span>
            <div className="flex space-x-2">
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  onClick={() => setSelectedDays(days)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    selectedDays === days
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {days}天
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 总体统计 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex items-center">
              <Activity className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">总请求数</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatNumber(stats?.total_requests || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">总Token数</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatNumber(stats?.total_tokens || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex items-center">
              <DollarSign className="h-8 w-8 text-yellow-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">总成本</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(stats?.total_cost || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* API Keys状态 */}
        <div className="bg-white rounded-lg shadow-sm border mb-8">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <CheckCircle className="h-5 w-5 mr-2 text-green-600" />
              API Keys状态
            </h2>
          </div>
          <div className="p-6">
            {apiKeys.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <p>暂无API Key</p>
                <p className="text-sm">请先添加API Key以开始使用</p>
              </div>
            ) : (
              <div className="space-y-4">
                {apiKeys.map((key) => (
                  <div key={key.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      {getProviderIcon(key.provider)}
                      <div>
                        <h3 className="font-medium text-gray-900">{key.display_name}</h3>
                        <p className="text-sm text-gray-600">{key.provider}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-600">使用情况</div>
                      <div className="text-sm font-medium">
                        {key.used_count} / {key.usage_limit}
                      </div>
                      <div className="w-24 bg-gray-200 rounded-full h-2 mt-1">
                        <div
                          className={`h-2 rounded-full ${
                            (key.used_count / key.usage_limit) >= 0.9
                              ? 'bg-red-500'
                              : (key.used_count / key.usage_limit) >= 0.7
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min((key.used_count / key.usage_limit) * 100, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 按提供商统计 */}
        {stats && Object.keys(stats.by_provider).length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border mb-8">
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <BarChart3 className="h-5 w-5 mr-2 text-blue-600" />
                按提供商统计
              </h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {Object.entries(stats.by_provider).map(([provider, data]: [string, any]) => (
                  <div key={provider} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      {getProviderIcon(provider)}
                      <div>
                        <h3 className="font-medium text-gray-900 capitalize">
                          {provider.replace('_', ' ')}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {data.requests} 请求 • {formatNumber(data.tokens)} tokens
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900">
                        {formatCurrency(data.cost)}
                      </div>
                      <div className="text-sm text-gray-600">总成本</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 每日使用趋势 */}
        {stats && stats.daily_breakdown.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Calendar className="h-5 w-5 mr-2 text-purple-600" />
                每日使用趋势
              </h2>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {stats.daily_breakdown.slice(0, 10).map((day) => (
                  <div key={day.date} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-900">
                        {new Date(day.date).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <div className="flex items-center space-x-6 text-sm text-gray-600">
                      <span>{day.requests} 请求</span>
                      <span>{formatNumber(day.tokens)} tokens</span>
                      <span className="font-medium text-gray-900">
                        {formatCurrency(day.cost)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 使用提示 */}
        <div className="mt-8 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-medium text-blue-900 mb-2">使用提示</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• 使用统计每24小时更新一次</li>
            <li>• API Key使用限制每日0点重置</li>
            <li>• 建议设置合理的每日使用限制以避免超出预算</li>
            <li>• 不同AI提供商的定价可能不同，请查看官方文档</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
};



