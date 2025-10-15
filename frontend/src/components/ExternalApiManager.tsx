// 外部API Key管理组件
// frontend/src/components/ExternalApiManager.tsx

import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Key, 
  Activity, 
  AlertTriangle, 
  CheckCircle,
  ExternalLink,
  Settings
} from 'lucide-react';
import { api } from '../utils/api';

interface ExternalApiKey {
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

interface Provider {
  id: string;
  name: string;
  description: string;
  features: string[];
  pricing: string;
  website: string;
}

interface ExternalApiManagerProps {
  className?: string;
}

export const ExternalApiManager: React.FC<ExternalApiManagerProps> = ({ 
  className = '' 
}) => {
  const [apiKeys, setApiKeys] = useState<ExternalApiKey[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newApiKey, setNewApiKey] = useState({
    provider: '',
    api_key: '',
    display_name: '',
    usage_limit: 100
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        const [keysResponse, providersResponse] = await Promise.all([
          api.get('/external/api-keys'),
          api.get('/external/providers')
        ]);
        
        setApiKeys(keysResponse.data.api_keys || []);
        setProviders(providersResponse.data.providers || []);
        
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleAddApiKey = async () => {
    try {
      const response = await fetch('/api/external/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newApiKey)
      });

      if (response.ok) {
        const result = await response.json();
        alert(`API Key添加成功！ID: ${result.api_key_id}`);
        
        // 重置表单
        setNewApiKey({
          provider: '',
          api_key: '',
          display_name: '',
          usage_limit: 100
        });
        setShowAddForm(false);
        
        // 刷新列表
        window.location.reload();
      } else {
        const error = await response.json();
        alert(`添加失败: ${error.message}`);
      }
    } catch (err) {
      alert(`添加失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDeleteApiKey = async (apiKeyId: string) => {
    if (!confirm('确定要删除这个API Key吗？')) return;
    
    try {
      const response = await fetch(`/api/external/api-keys/${apiKeyId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('API Key删除成功');
        window.location.reload();
      } else {
        const error = await response.json();
        alert(`删除失败: ${error.message}`);
      }
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const getProviderInfo = (providerId: string) => {
    return providers.find(p => p.id === providerId);
  };

  const getProviderIcon = (providerId: string) => {
    switch (providerId) {
      case 'gemini_pro':
        return <div className="w-6 h-6 bg-blue-500 rounded flex items-center justify-center text-white text-xs font-bold">G</div>;
      case 'openai_plus':
        return <div className="w-6 h-6 bg-green-500 rounded flex items-center justify-center text-white text-xs font-bold">O</div>;
      case 'claude_pro':
        return <div className="w-6 h-6 bg-purple-500 rounded flex items-center justify-center text-white text-xs font-bold">C</div>;
      default:
        return <Key className="h-6 w-6 text-gray-600" />;
    }
  };

  const getUsagePercentage = (used: number, limit: number) => {
    return Math.min((used / limit) * 100, 100);
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

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
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>加载失败</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">外部API Key管理</h2>
          <p className="text-sm text-gray-600">使用您自己的AI服务API Key进行分析</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>添加API Key</span>
        </button>
      </div>

      {/* 添加API Key表单 */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-medium text-gray-900 mb-4">添加新的API Key</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AI服务提供商</label>
              <select
                value={newApiKey.provider}
                onChange={(e) => setNewApiKey({ ...newApiKey, provider: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">选择提供商</option>
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
              <input
                type="text"
                value={newApiKey.display_name}
                onChange={(e) => setNewApiKey({ ...newApiKey, display_name: e.target.value })}
                placeholder="例如：我的Gemini Pro Key"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
              <input
                type="password"
                value={newApiKey.api_key}
                onChange={(e) => setNewApiKey({ ...newApiKey, api_key: e.target.value })}
                placeholder="输入您的API Key"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">每日使用限制</label>
              <input
                type="number"
                value={newApiKey.usage_limit}
                onChange={(e) => setNewApiKey({ ...newApiKey, usage_limit: Number(e.target.value) })}
                min="1"
                max="10000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          
          <div className="mt-4 flex items-center justify-end space-x-3">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleAddApiKey}
              disabled={!newApiKey.provider || !newApiKey.api_key || !newApiKey.display_name}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              添加API Key
            </button>
          </div>
        </div>
      )}

      {/* API Keys列表 */}
      {apiKeys.length === 0 ? (
        <div className="text-center py-8">
          <Key className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">暂无API Key</h3>
          <p className="text-gray-600 mb-4">添加您的AI服务API Key以使用外部分析功能</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            添加第一个API Key
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {apiKeys.map((apiKey) => {
            const provider = getProviderInfo(apiKey.provider);
            const usagePercentage = getUsagePercentage(apiKey.used_count, apiKey.usage_limit);
            
            return (
              <div key={apiKey.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {getProviderIcon(apiKey.provider)}
                    <div>
                      <h3 className="font-medium text-gray-900">{apiKey.display_name}</h3>
                      <p className="text-sm text-gray-600">
                        {provider?.name || apiKey.provider} • 
                        创建于 {new Date(apiKey.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <div className="text-sm text-gray-600">使用情况</div>
                      <div className="text-sm font-medium">
                        {apiKey.used_count} / {apiKey.usage_limit}
                      </div>
                    </div>
                    
                    <div className="w-16">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${getUsageColor(usagePercentage)}`}
                          style={{ width: `${usagePercentage}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => handleDeleteApiKey(apiKey.id)}
                      className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                
                {provider && (
                  <div className="mt-3 p-3 bg-gray-50 rounded">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-700">{provider.description}</p>
                        <div className="flex items-center space-x-4 mt-1">
                          <span className="text-xs text-gray-500">定价: {provider.pricing}</span>
                          <a
                            href={provider.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                          >
                            <span>官网</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">支持功能</div>
                        <div className="text-xs text-gray-700">
                          {provider.features.join(' • ')}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 使用说明 */}
      <div className="mt-8 p-4 bg-blue-50 rounded-lg">
        <h3 className="text-lg font-medium text-blue-900 mb-2">使用说明</h3>
        <div className="text-sm text-blue-800 space-y-2">
          <p>• 添加您的AI服务API Key后，可以使用您自己的额度进行股票分析</p>
          <p>• 支持Google Gemini Pro、OpenAI GPT-4、Anthropic Claude等主流AI服务</p>
          <p>• 系统会自动跟踪使用情况，避免超出您的API限制</p>
          <p>• 使用外部API Key的分析结果会单独记录，不影响平台成本</p>
        </div>
      </div>
    </div>
  );
};
