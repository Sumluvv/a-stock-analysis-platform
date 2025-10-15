import React, { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Activity } from 'lucide-react'
import { api } from '../utils/api'

interface TechnicalIndicator {
  date: string
  ma5?: number
  ma10?: number
  ma20?: number
  ma60?: number
  macd?: number
  macd_signal?: number
  macd_histogram?: number
  rsi?: number
  boll_upper?: number
  boll_middle?: number
  boll_lower?: number
}

interface TechnicalIndicatorsProps {
  tsCode: string
}

export const TechnicalIndicators: React.FC<TechnicalIndicatorsProps> = ({ tsCode }) => {
  const [indicators, setIndicators] = useState<TechnicalIndicator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchIndicators = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const response = await api.get(`/feeds/kline/${tsCode}`)
        const payload = response.data || {}
        const raw = payload.indicators || payload.data?.indicators || []
        const mapped = raw.map((t: any) => ({
          date: (t.trade_date || t.date || '').toString().slice(0,10),
          ma5: t.ma5 != null ? Number(t.ma5) : undefined,
          ma10: t.ma10 != null ? Number(t.ma10) : undefined,
          ma20: t.ma20 != null ? Number(t.ma20) : undefined,
          ma60: t.ma60 != null ? Number(t.ma60) : undefined,
          macd: t.macd != null ? Number(t.macd) : undefined,
          macd_signal: t.macd_signal != null ? Number(t.macd_signal) : undefined,
          macd_histogram: (t.macd_hist ?? t.macd_histogram) != null ? Number(t.macd_hist ?? t.macd_histogram) : undefined,
          rsi: (t.rsi14 ?? t.rsi6 ?? t.rsi) != null ? Number(t.rsi14 ?? t.rsi6 ?? t.rsi) : undefined,
          boll_upper: t.boll_upper != null ? Number(t.boll_upper) : undefined,
          boll_middle: (t.boll_mid ?? t.boll_middle) != null ? Number(t.boll_mid ?? t.boll_middle) : undefined,
          boll_lower: t.boll_lower != null ? Number(t.boll_lower) : undefined,
        }))
        // 若无指标，尝试数据状态检查并触发导入后重试
        if (mapped.length === 0) {
          try {
            const statusResp = await api.get(`/feeds/data-status/${tsCode}`)
            const st = statusResp.data || {}
            if (!st.has_kline) {
              await api.post(`/feeds/auto-import/${tsCode}`)
              // 轮询等待至多 30 秒
              let ok = false
              for (let i = 0; i < 6; i++) {
                await new Promise(r => setTimeout(r, 5000))
                const s2 = await api.get(`/feeds/data-status/${tsCode}`)
                if (s2.data?.has_kline) { ok = true; break }
              }
              if (ok) {
                const retry = await api.get(`/feeds/kline/${tsCode}`)
                const raw2 = retry.data?.indicators || []
                const mapped2 = raw2.map((t: any) => ({
                  date: (t.trade_date || t.date || '').toString().slice(0,10),
                  ma5: t.ma5 != null ? Number(t.ma5) : undefined,
                  ma10: t.ma10 != null ? Number(t.ma10) : undefined,
                  ma20: t.ma20 != null ? Number(t.ma20) : undefined,
                  ma60: t.ma60 != null ? Number(t.ma60) : undefined,
                  macd: t.macd != null ? Number(t.macd) : undefined,
                  macd_signal: t.macd_signal != null ? Number(t.macd_signal) : undefined,
                  macd_histogram: (t.macd_hist ?? t.macd_histogram) != null ? Number(t.macd_hist ?? t.macd_histogram) : undefined,
                  rsi: (t.rsi14 ?? t.rsi6 ?? t.rsi) != null ? Number(t.rsi14 ?? t.rsi6 ?? t.rsi) : undefined,
                  boll_upper: t.boll_upper != null ? Number(t.boll_upper) : undefined,
                  boll_middle: (t.boll_mid ?? t.boll_middle) != null ? Number(t.boll_mid ?? t.boll_middle) : undefined,
                  boll_lower: t.boll_lower != null ? Number(t.boll_lower) : undefined,
                }))
                setIndicators(mapped2)
                return
              }
            }
          } catch {}
        }
        setIndicators(mapped)
      } catch (err) {
        setError('获取技术指标失败')
        console.error('Error fetching indicators:', err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchIndicators()
  }, [tsCode])

  const getLatestValue = (key: keyof TechnicalIndicator) => {
    const latest = indicators[indicators.length - 1]
    return latest?.[key] || 0
  }

  const getIndicatorStatus = (value: number, type: 'rsi' | 'macd') => {
    if (type === 'rsi') {
      if (value > 70) return { status: 'overbought', text: '超买', color: 'text-danger-600' }
      if (value < 30) return { status: 'oversold', text: '超卖', color: 'text-success-600' }
      return { status: 'normal', text: '正常', color: 'text-gray-600' }
    }
    
    if (type === 'macd') {
      if (value > 0) return { status: 'bullish', text: '看涨', color: 'text-success-600' }
      return { status: 'bearish', text: '看跌', color: 'text-danger-600' }
    }
    
    return { status: 'normal', text: '正常', color: 'text-gray-600' }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="loading-spinner"></div>
        <span className="ml-3 text-gray-600">加载技术指标中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center text-red-600 py-8">
        <p>{error}</p>
      </div>
    )
  }

  if (indicators.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <p>暂无技术指标数据</p>
      </div>
    )
  }

  const latest = indicators[indicators.length - 1]
  const rsiStatus = getIndicatorStatus(getLatestValue('rsi'), 'rsi')
  const macdStatus = getIndicatorStatus(getLatestValue('macd'), 'macd')

  return (
    <div className="space-y-6">
      {/* 移动平均线 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <TrendingUp className="h-5 w-5 mr-2 text-primary-600" />
          移动平均线
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">MA5</div>
            <div className="text-xl font-bold text-blue-600">
              {latest.ma5?.toFixed(2) || '--'}
            </div>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">MA10</div>
            <div className="text-xl font-bold text-orange-600">
              {latest.ma10?.toFixed(2) || '--'}
            </div>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">MA20</div>
            <div className="text-xl font-bold text-purple-600">
              {latest.ma20?.toFixed(2) || '--'}
            </div>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">MA60</div>
            <div className="text-xl font-bold text-cyan-600">
              {latest.ma60?.toFixed(2) || '--'}
            </div>
          </div>
        </div>
      </div>

      {/* 技术指标 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Activity className="h-5 w-5 mr-2 text-primary-600" />
          技术指标
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* RSI */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">RSI (相对强弱指数)</span>
              <span className={`text-sm font-medium ${rsiStatus.color}`}>
                {rsiStatus.text}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {latest.rsi?.toFixed(2) || '--'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              超买: &gt;70 | 超卖: &lt;30
            </div>
          </div>

          {/* MACD */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">MACD</span>
              <span className={`text-sm font-medium ${macdStatus.color}`}>
                {macdStatus.text}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {latest.macd?.toFixed(4) || '--'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              信号线: {latest.macd_signal?.toFixed(4) || '--'}
            </div>
          </div>

          {/* 布林带 */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600 mb-2">布林带</div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>上轨:</span>
                <span className="font-medium">{latest.boll_upper?.toFixed(2) || '--'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>中轨:</span>
                <span className="font-medium">{latest.boll_middle?.toFixed(2) || '--'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>下轨:</span>
                <span className="font-medium">{latest.boll_lower?.toFixed(2) || '--'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 技术分析总结 */}
      <div className="p-4 bg-blue-50 rounded-lg">
        <h4 className="font-semibold text-blue-900 mb-2">技术分析总结</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p>• RSI指标: {rsiStatus.text} ({latest.rsi?.toFixed(2) || '--'})</p>
          <p>• MACD指标: {macdStatus.text} ({latest.macd?.toFixed(4) || '--'})</p>
          <p>• 移动平均线: 短期趋势分析中...</p>
        </div>
      </div>
    </div>
  )
}
