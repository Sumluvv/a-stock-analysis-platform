import React, { useEffect, useState } from 'react'
import { api } from '../utils/api'
import { ExternalApiManager } from '../components/ExternalApiManager'

export const AgentsPage: React.FC = () => {
  const [health, setHealth] = useState<string>('checking...')
  const [loading, setLoading] = useState<boolean>(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const checkHealth = async () => {
    try {
      const resp = await api.get('/ai/health')
      setHealth(resp.data?.status || 'unknown')
    } catch (e: any) {
      setHealth('unavailable')
    }
  }

  useEffect(() => { checkHealth() }, [])

  const triggerTask = async (kind: 'insight' | 'news' | 'strategy') => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const resp = await api.post(`/ai/${kind}`, {})
      setResult(resp.data)
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">多智能体</h1>
        <div className="text-sm text-gray-500">AI服务健康状态：<span className={health === 'ok' ? 'text-green-600' : 'text-red-600'}>{health}</span></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <button onClick={() => triggerTask('insight')} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-3 text-sm disabled:opacity-60" disabled={loading}>生成洞见</button>
        <button onClick={() => triggerTask('news')} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-3 text-sm disabled:opacity-60" disabled={loading}>新闻解读</button>
        <button onClick={() => triggerTask('strategy')} className="bg-teal-600 hover:bg-teal-700 text-white rounded px-4 py-3 text-sm disabled:opacity-60" disabled={loading}>策略建议</button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm">{error}</div>
      )}
      {loading && (
        <div className="mb-4 text-sm text-gray-600">正在处理，请稍候...</div>
      )}
      {result && (
        <pre className="mb-6 p-3 bg-gray-50 rounded text-xs overflow-auto">{JSON.stringify(result, null, 2)}</pre>
      )}

      <div className="mt-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">使用自带外部 API Key</h2>
        <p className="text-sm text-gray-600 mb-3">在下方管理并选择外部API（Gemini/OpenAI/Claude等）以使用多智能体能力。</p>
        <ExternalApiManager />
      </div>
    </div>
  )
}





