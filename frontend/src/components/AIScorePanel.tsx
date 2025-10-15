import React, { useState, useEffect } from 'react'
import { Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Star } from 'lucide-react'
import { api } from '../utils/api'

interface AIScoreData {
  ts_code: string
  as_of_date: string
  score: number
  action: string
  model_version: string
  current_price: number
  top_factors: Array<[string, number]>
  analysis: {
    score_analysis: string
    action_analysis: string
    confidence: string
  }
  created_at: string
}

interface AIScorePanelProps {
  tsCode: string
}

export const AIScorePanel: React.FC<AIScorePanelProps> = ({ tsCode }) => {
  const [aiScore, setAiScore] = useState<AIScoreData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchAIScore = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await api.get(`/valuation/ai-score/${tsCode}`)
        setAiScore(response.data)
      } catch (err: any) {
        if (err?.response?.status === 404) {
          setAiScore(null)
          setError('no-data')
        } else {
          setError('获取AI评分失败')
        }
        console.error('Error fetching AI score:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchAIScore()
  }, [tsCode])

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50'
    if (score >= 70) return 'text-green-500 bg-green-50'
    if (score >= 60) return 'text-yellow-600 bg-yellow-50'
    if (score >= 40) return 'text-orange-600 bg-orange-50'
    return 'text-red-600 bg-red-50'
  }

  const getActionColor = (action: string) => {
    if (action.includes('强烈买入') || action.includes('买入')) return 'text-green-600'
    if (action.includes('持有')) return 'text-yellow-600'
    if (action.includes('观望')) return 'text-orange-600'
    return 'text-red-600'
  }

  const getActionIcon = (action: string) => {
    if (action.includes('强烈买入')) return <Star className="h-4 w-4" />
    if (action.includes('买入')) return <TrendingUp className="h-4 w-4" />
    if (action.includes('持有')) return <CheckCircle className="h-4 w-4" />
    if (action.includes('观望')) return <AlertTriangle className="h-4 w-4" />
    return <TrendingDown className="h-4 w-4" />
  }

  const getConfidenceColor = (confidence: string) => {
    if (confidence === '高') return 'text-green-600'
    if (confidence === '中') return 'text-yellow-600'
    return 'text-red-600'
  }

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="flex items-center space-x-2">
            <Brain className="h-5 w-5 text-primary-600" />
            <h2 className="card-title">AI智能评分</h2>
          </div>
        </div>
        <div className="card-content">
          <div className="flex items-center justify-center h-32">
            <div className="loading-spinner"></div>
            <span className="ml-3 text-gray-600">加载中...</span>
          </div>
        </div>
      </div>
    )
  }

  if ((error && error !== 'no-data') || (!aiScore && error !== 'no-data')) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="flex items-center space-x-2">
            <Brain className="h-5 w-5 text-primary-600" />
            <h2 className="card-title">AI智能评分</h2>
          </div>
        </div>
        <div className="card-content">
          <div className="text-center text-gray-500 py-8">
            <p>{error || '加载失败'}</p>
          </div>
        </div>
      </div>
    )
  }

  if (error === 'no-data') {
    return (
      <div className="card">
        <div className="card-header">
          <div className="flex items-center space-x-2">
            <Brain className="h-5 w-5 text-primary-600" />
            <h2 className="card-title">AI智能评分</h2>
          </div>
        </div>
        <div className="card-content">
          <div className="text-center text-gray-500 py-8 space-y-4">
            <p>暂无AI评分数据</p>
            <button
              className="btn btn-primary px-4"
              onClick={async () => {
                try {
                  setLoading(true)
                  await api.post(`/valuation/ai-score/${tsCode}/calculate`)
                  const resp = await api.get(`/valuation/ai-score/${tsCode}`)
                  setAiScore(resp.data)
                  setError(null)
                } catch (e) {
                  console.error('AI score calculate error', e)
                } finally {
                  setLoading(false)
                }
              }}
            >
              一键计算AI评分
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center space-x-2">
          <Brain className="h-5 w-5 text-primary-600" />
          <h2 className="card-title">AI智能评分</h2>
          <span className="text-xs text-gray-500">v{aiScore.model_version}</span>
        </div>
      </div>
      <div className="card-content space-y-4">
        {/* 评分和投资建议 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`p-4 rounded-lg ${getScoreColor(aiScore.score)}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">AI评分</span>
              <span className="text-2xl font-bold">{aiScore.score}</span>
            </div>
            <div className="text-xs mt-1">{aiScore.analysis.score_analysis}</div>
          </div>
          
          <div className="p-4 rounded-lg bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">投资建议</span>
              <div className="flex items-center space-x-1">
                {getActionIcon(aiScore.action)}
                <span className={`font-semibold ${getActionColor(aiScore.action)}`}>
                  {aiScore.action}
                </span>
              </div>
            </div>
            <div className="text-xs mt-1 text-gray-600">{aiScore.analysis.action_analysis}</div>
          </div>
        </div>

        {/* 关键因素 */}
        <div>
          <h4 className="font-semibold text-gray-900 mb-2">关键因素</h4>
          <div className="space-y-2">
            {aiScore.top_factors.map(([factor, score], index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{factor}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-16 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-primary-600 h-2 rounded-full" 
                      style={{ width: `${Math.abs(score) * 10}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {score > 0 ? '+' : ''}{score.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 置信度分析 */}
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">置信度</span>
            <span className={`text-sm font-semibold ${getConfidenceColor(aiScore.analysis.confidence)}`}>
              {aiScore.analysis.confidence}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            基于{aiScore.top_factors.length}个关键因素的综合分析
          </div>
        </div>

        {/* 更新时间 */}
        <div className="text-xs text-gray-500 text-center">
          更新时间: {new Date(aiScore.created_at).toLocaleString()}
        </div>
      </div>
    </div>
  )
}
