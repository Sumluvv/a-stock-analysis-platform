import React, { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, TrendingUp, TrendingDown, Calculator, BarChart3, Brain } from 'lucide-react'
import { KLineChart } from '../components/KLineChart'
import { ValuationPanel } from '../components/ValuationPanel'
import { TechnicalIndicators } from '../components/TechnicalIndicators'
import DCFPanel from '../components/DCFPanel'
import { AIScorePanel } from '../components/AIScorePanel'
import { StockAIAnalysis } from '../components/StockAIAnalysis'
import { api } from '../utils/api'

interface StockDetail {
  ts_code: string
  name: string
  industry: string
  market: string
  list_date: string
  last_price: number
  change_percent: number
  pe_ratio?: number
  pb_ratio?: number
  eps?: number
  bps?: number
  roe?: number
}

export const StockDetailPage: React.FC = () => {
  const { tsCode } = useParams<{ tsCode: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [stock, setStock] = useState<StockDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiEnabled, setAiEnabled] = useState<boolean>(searchParams.get('ai') !== '0')
  const [predLen, setPredLen] = useState<number>(Number(searchParams.get('pred') || '20'))
  const [showMACD, setShowMACD] = useState<boolean>(true)
  const [showRSI, setShowRSI] = useState<boolean>(true)
  const [showBOLL, setShowBOLL] = useState<boolean>(true)
  const [showMAsubplot, setShowMAsubplot] = useState<boolean>(true)

  useEffect(() => {
    if (!tsCode) return
    
    const fetchStockDetail = async () => {
      try {
        setLoading(true)
        setError(null)
        
        // 获取股票概览信息
        let overview: any
        try {
          const overviewResponse = await api.get(`/feeds/overview/${tsCode}`)
          overview = overviewResponse.data
        } catch (e: any) {
          // 若404，触发自动导入并轮询
          if (e?.response?.status === 404) {
            console.log(`股票 ${tsCode} 数据不存在，触发自动导入...`)
            await api.post(`/feeds/auto-import/${tsCode}`)
            
            // 使用数据状态检查进行轮询，最多等待30秒
            let importComplete = false
            let attempts = 0
            const maxAttempts = 6 // 6次 * 5秒 = 30秒
            
            while (!importComplete && attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 5000))
              attempts++
              
              try {
                // 检查数据状态
                const statusResponse = await api.get(`/feeds/data-status/${tsCode}`)
                const status = statusResponse.data
                
                console.log(`股票 ${tsCode} 数据状态 (${attempts}/${maxAttempts}):`, status)
                
                // 如果概览数据已生成，重新获取
                if (status.has_overview) {
                  const retryResponse = await api.get(`/feeds/overview/${tsCode}`)
                  overview = retryResponse.data
                  console.log(`股票 ${tsCode} 导入成功`)
                  importComplete = true
                }
              } catch (statusErr) {
                console.warn(`检查数据状态失败:`, statusErr)
              }
            }
            
            if (!importComplete) {
              console.warn(`股票 ${tsCode} 导入超时`)
            }
          } else {
            throw e
          }
        }

        // 检查数据完整性，如果缺少重要数据则触发自动导入
        try {
          const statusResponse = await api.get(`/feeds/data-status/${tsCode}`)
          const status = statusResponse.data
          
          // 如果缺少估值、AI评分或DCF数据，触发自动导入
          if (!status.has_valuation || !status.has_ai_score || !status.has_dcf) {
            console.log(`股票 ${tsCode} 数据不完整，触发自动导入...`)
            console.log(`数据状态:`, status)
            
            await api.post(`/feeds/auto-import/${tsCode}`)
            
            // 等待导入完成，最多等待30秒
            let importComplete = false
            let attempts = 0
            const maxAttempts = 6 // 6次 * 5秒 = 30秒
            
            while (!importComplete && attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 5000))
              attempts++
              
              try {
                const newStatusResponse = await api.get(`/feeds/data-status/${tsCode}`)
                const newStatus = newStatusResponse.data
                
                console.log(`股票 ${tsCode} 数据状态更新 (${attempts}/${maxAttempts}):`, newStatus)
                
                // 如果所有重要数据都有了，认为导入完成
                if (newStatus.has_valuation && newStatus.has_ai_score) {
                  console.log(`股票 ${tsCode} 数据导入完成`)
                  importComplete = true
                  
                  // 如果DCF数据还没有，单独触发DCF计算
                  if (!newStatus.has_dcf) {
                    console.log(`股票 ${tsCode} 缺少DCF数据，触发DCF计算...`)
                    try {
                      await api.post(`/valuation/dcf/${tsCode}/calculate`)
                      console.log(`股票 ${tsCode} DCF计算已触发`)
                    } catch (dcfErr) {
                      console.warn(`DCF计算触发失败:`, dcfErr)
                    }
                  }
                }
              } catch (statusErr) {
                console.warn(`检查数据状态失败:`, statusErr)
              }
            }
            
            if (!importComplete) {
              console.warn(`股票 ${tsCode} 数据导入超时`)
            }
          }
        } catch (statusErr) {
          console.warn(`检查数据状态失败:`, statusErr)
        }
        
        // 获取估值信息
        let valuation = null
        try {
          const valuationResponse = await api.get(`/valuation/${tsCode}`)
          valuation = valuationResponse.data
        } catch (err) {
          console.warn('估值数据获取失败:', err)
        }
        
        // 合并数据
        const stockDetail: StockDetail = {
          ts_code: overview.basic?.ts_code || tsCode,
          name: overview.basic?.name || '未知股票',
          industry: overview.basic?.industry || '未知行业',
          market: overview.basic?.market || '未知市场',
          list_date: overview.basic?.list_date || '',
          last_price: Number(overview.last_price?.close ?? 0),
          change_percent: overview.last_price?.change_percent || 0,
          pe_ratio: valuation?.valuation?.pe_ratio,
          pb_ratio: valuation?.valuation?.pb_ratio,
          eps: valuation?.financials?.eps,
          bps: valuation?.financials?.bps,
          roe: valuation?.financials?.roe,
        }
        
        setStock(stockDetail)
      } catch (err) {
        setError('获取股票信息失败')
        console.error('Error fetching stock detail:', err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchStockDetail()
  }, [tsCode])

  const formatPrice = (price: number | string | null | undefined) => {
    const n = Number(price)
    if (Number.isNaN(n)) return '--'
    return n.toFixed(2)
  }

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? '+' : ''
    return `${sign}${percent.toFixed(2)}%`
  }

  const getPriceColor = (percent: number) => {
    if (percent > 0) return 'price-up'
    if (percent < 0) return 'price-down'
    return 'price-neutral'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="loading-spinner"></div>
        <span className="ml-3 text-gray-600">加载中...</span>
      </div>
    )
  }

  if (error || !stock) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 text-lg">{error || '股票信息不存在'}</p>
        <button 
          onClick={() => window.history.back()}
          className="btn btn-outline mt-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 返回按钮 */}
      <button 
        onClick={() => window.history.back()}
        className="btn btn-ghost"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        返回
      </button>

      {/* 股票基本信息 */}
      <div className="card">
        <div className="card-header">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="card-title text-3xl">{stock.name}</h1>
              <p className="text-lg text-gray-600">{stock.ts_code}</p>
              <p className="text-sm text-gray-500">{stock.industry} · {stock.market}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">
                ¥{formatPrice(stock.last_price)}
              </div>
              <div className={`flex items-center justify-end space-x-2 ${getPriceColor(stock.change_percent)}`}>
                {stock.change_percent >= 0 ? (
                  <TrendingUp className="h-5 w-5" />
                ) : (
                  <TrendingDown className="h-5 w-5" />
                )}
                <span className="text-lg font-semibold">
                  {formatPercent(stock.change_percent)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* K线图表 */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="card-header">
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-5 w-5 text-primary-600" />
                <h2 className="card-title">K线图表</h2>
              </div>
            </div>
            <div className="card-content">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={aiEnabled}
                      onChange={(e) => {
                        const next = e.target.checked
                        setAiEnabled(next)
                        const sp = new URLSearchParams(searchParams)
                        if (next) sp.set('ai', '1'); else sp.delete('ai')
                        setSearchParams(sp, { replace: true })
                      }}
                    />
                    <span>AI预测</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">快捷</span>
                    <div className="btn-group">
                      <button className={`btn btn-xs ${predLen===20?'btn-primary':'btn-outline'}`} onClick={() => { setPredLen(20); const sp = new URLSearchParams(searchParams); sp.set('pred','20'); setSearchParams(sp,{replace:true}) }}>20</button>
                      <button className={`btn btn-xs ${predLen===40?'btn-primary':'btn-outline'}`} onClick={() => { setPredLen(40); const sp = new URLSearchParams(searchParams); sp.set('pred','40'); setSearchParams(sp,{replace:true}) }}>40</button>
                      <button className={`btn btn-xs ${predLen===60?'btn-primary':'btn-outline'}`} onClick={() => { setPredLen(60); const sp = new URLSearchParams(searchParams); sp.set('pred','60'); setSearchParams(sp,{replace:true}) }}>60</button>
                    </div>
                  </label>
                  <label className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">步数</span>
                    <select
                      className="select select-sm"
                      value={predLen}
                      onChange={(e) => {
                        const v = Number(e.target.value || '20')
                        setPredLen(v)
                        const sp = new URLSearchParams(searchParams)
                        if (v) sp.set('pred', String(v)); else sp.delete('pred')
                        setSearchParams(sp, { replace: true })
                      }}
                    >
                      <option value={20}>20</option>
                      <option value={60}>60</option>
                    </select>
                  </label>
                  <div className="hidden md:flex items-center space-x-3">
                    <label className="flex items-center space-x-1"><input type="checkbox" checked={showMACD} onChange={(e)=>setShowMACD(e.target.checked)} /><span>MACD</span></label>
                    <label className="flex items-center space-x-1"><input type="checkbox" checked={showRSI} onChange={(e)=>setShowRSI(e.target.checked)} /><span>RSI</span></label>
                    <label className="flex items-center space-x-1"><input type="checkbox" checked={showBOLL} onChange={(e)=>setShowBOLL(e.target.checked)} /><span>BOLL</span></label>
                    <label className="flex items-center space-x-1"><input type="checkbox" checked={showMAsubplot} onChange={(e)=>setShowMAsubplot(e.target.checked)} /><span>MA副图</span></label>
                  </div>
                </div>
              </div>
              <KLineChart tsCode={tsCode!} aiEnabled={aiEnabled} predLen={predLen} showBand={true} showMACD={showMACD} showRSI={showRSI} showBOLL={showBOLL} showMAsubplot={showMAsubplot} />
            </div>
          </div>
        </div>

        {/* 估值信息 */}
        <div className="space-y-6">
          <ValuationPanel tsCode={tsCode!} />
          <AIScorePanel tsCode={tsCode!} />
          
          {/* AI智能分析 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center space-x-2 mb-4">
              <Brain className="h-5 w-5 text-blue-500" />
              <h3 className="text-lg font-semibold text-gray-900">AI智能分析</h3>
            </div>
            <StockAIAnalysis tsCode={tsCode!} stockData={stock} />
          </div>
        </div>
      </div>

      {/* DCF估值分析 */}
      <DCFPanel tsCode={tsCode!} />

      {/* 技术指标 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">技术指标</h2>
        </div>
        <div className="card-content">
          <TechnicalIndicators tsCode={tsCode!} />
        </div>
      </div>
    </div>
  )
}
