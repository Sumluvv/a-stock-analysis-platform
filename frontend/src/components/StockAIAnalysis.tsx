// 股票AI分析组件
// frontend/src/components/StockAIAnalysis.tsx

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Brain, Zap, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface StockAIAnalysisProps {
  tsCode: string;
  stockData: any;
}

interface AIAnalysisResult {
  summary: string;
  action: string;
  confidence: number;
  reasoning: string;
  api_key_id: string;
  analysis_type: string;
  response_time_ms: number;
  success: boolean;
}

export const StockAIAnalysis: React.FC<StockAIAnalysisProps> = ({ 
  tsCode, 
  stockData 
}) => {
  const [analysisResult, setAnalysisResult] = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [selectedApiKey, setSelectedApiKey] = useState<string>('');

  // 获取用户的API Keys
  useEffect(() => {
    const fetchApiKeys = async () => {
      try {
        const response = await api.get('/external/api-keys');
        setApiKeys(response.data.api_keys || []);
        if (response.data.api_keys?.length > 0) {
          setSelectedApiKey(response.data.api_keys[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch API keys:', err);
      }
    };

    fetchApiKeys();
  }, []);

  const handleAnalyze = async () => {
    if (!selectedApiKey) {
      setError('请先添加API Key');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/external/ai-analysis', {
        api_key_id: selectedApiKey,
        ts_code: tsCode,
        analysis_type: 'stock_analysis',
        stock_data: stockData
      });

      setAnalysisResult(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || '分析失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case 'buy':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'sell':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'hold':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'watch':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getActionText = (action: string) => {
    switch (action.toLowerCase()) {
      case 'buy':
        return '买入';
      case 'sell':
        return '卖出';
      case 'hold':
        return '持有';
      case 'watch':
        return '观望';
      default:
        return action;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <Brain className="h-5 w-5 mr-2 text-purple-600" />
          AI智能分析
        </h3>
        <div className="text-sm text-gray-500">
          使用您自己的AI服务
        </div>
      </div>

      {/* API Key选择 */}
      {apiKeys.length > 0 ? (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            选择API Key
          </label>
          <select
            value={selectedApiKey}
            onChange={(e) => setSelectedApiKey(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {apiKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.display_name} ({key.provider})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-center">
            <AlertCircle className="h-4 w-4 text-yellow-600 mr-2" />
            <span className="text-sm text-yellow-800">
              请先添加API Key才能使用AI分析功能
            </span>
          </div>
        </div>
      )}

      {/* 分析按钮 */}
      <button
        onClick={handleAnalyze}
        disabled={loading || !selectedApiKey}
        className="w-full mb-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            分析中...
          </>
        ) : (
          <>
            <Zap className="h-4 w-4 mr-2" />
            开始AI分析
          </>
        )}
      </button>

      {/* 错误信息 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center">
            <AlertCircle className="h-4 w-4 text-red-600 mr-2" />
            <span className="text-sm text-red-800">{error}</span>
          </div>
        </div>
      )}

      {/* 分析结果 */}
      {analysisResult && (
        <div className="space-y-4">
          {/* 分析摘要 */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-gray-900 mb-2">分析摘要</h4>
            <p className="text-gray-700">{analysisResult.summary}</p>
          </div>

          {/* 投资建议 */}
          <div className="flex items-center justify-between p-4 bg-white border rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900 mb-1">投资建议</h4>
              <p className="text-sm text-gray-600">基于AI分析结果</p>
            </div>
            <div className={`px-3 py-1 rounded-full border font-medium ${getActionColor(analysisResult.action)}`}>
              {getActionText(analysisResult.action)}
            </div>
          </div>

          {/* 置信度 */}
          <div className="flex items-center justify-between p-4 bg-white border rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900 mb-1">置信度</h4>
              <p className="text-sm text-gray-600">分析结果的可信程度</p>
            </div>
            <div className="flex items-center">
              <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                <div
                  className="bg-purple-600 h-2 rounded-full"
                  style={{ width: `${analysisResult.confidence * 100}%` }}
                ></div>
              </div>
              <span className="text-sm font-medium text-gray-900">
                {(analysisResult.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* 详细分析 */}
          <div className="p-4 bg-white border rounded-lg">
            <h4 className="font-medium text-gray-900 mb-2">详细分析</h4>
            <p className="text-gray-700 text-sm leading-relaxed">
              {analysisResult.reasoning}
            </p>
          </div>

          {/* 技术信息 */}
          <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t">
            <span>响应时间: {analysisResult.response_time_ms}ms</span>
            <span>分析类型: {analysisResult.analysis_type}</span>
          </div>
        </div>
      )}

      {/* 使用说明 */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-2">使用说明</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• AI分析使用您自己的API Key，不消耗平台额度</li>
          <li>• 分析结果仅供参考，投资决策请谨慎</li>
          <li>• 支持多种AI服务提供商（Gemini Pro、OpenAI GPT-4等）</li>
          <li>• 分析结果会保存到您的使用记录中</li>
        </ul>
      </div>
    </div>
  );
};



