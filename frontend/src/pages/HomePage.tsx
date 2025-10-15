import React, { useState, useEffect } from 'react'
import { Search, TrendingUp, BarChart3, Calculator, X, MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { StockCard } from '../components/StockCard'
import { StockRankingCard } from '../components/StockRankingCard'
import { api } from '../utils/api'

interface StockOverview {
  ts_code: string
  name: string
  industry: string
  market: string
  list_date: string
  last_price?: number
  change_percent?: number
  pe_ratio?: number
  pb_ratio?: number
}

interface StockRankingItem {
  ts_code: string
  name: string
  industry: string
  market: string
  last_price?: number
  change_percent?: number
  vol?: number
  amount?: number
  boards?: number
  rank: number
}

export const HomePage: React.FC = () => {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [stocks, setStocks] = useState<StockOverview[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hots, setHots] = useState<StockOverview[]>([])
  const [hotTick, setHotTick] = useState(0)
  const [importing, setImporting] = useState<Set<string>>(new Set())
  const [suggestions, setSuggestions] = useState<Array<{ ts_code: string; name: string }>>([])
  const [showSuggest, setShowSuggest] = useState(false)
  const [recent, setRecent] = useState<Array<{ ts_code: string; name: string }>>([])
  
  // 榜单数据
  const [firstLimitStocks, setFirstLimitStocks] = useState<StockRankingItem[]>([])
  const [maxGainStocks, setMaxGainStocks] = useState<StockRankingItem[]>([])
  const [volumeStocks, setVolumeStocks] = useState<StockRankingItem[]>([])
  const [amountStocks, setAmountStocks] = useState<StockRankingItem[]>([])
  const [rankingsLoading, setRankingsLoading] = useState(false)

  // 加载热门股票
  useEffect(() => {
    const loadHots = async () => {
      try {
        const resp = await api.get(`/feeds/hot?limit=9&_t=${Date.now()}`)
        const items = resp.data?.items || []
        const mapped: StockOverview[] = items.map((it: any) => ({
          ts_code: it.ts_code,
          name: (it.name || '').toString().trim(),
          industry: it.industry || '',
          market: it.exchange || '',
          list_date: it.trade_date || '',
          last_price: it.close != null ? Number(it.close) : undefined,
          change_percent: it.pct_chg != null ? Number(it.pct_chg) : undefined,
          pe_ratio: undefined,
          pb_ratio: undefined,
        }))
        setHots(mapped)
      } catch (e) {
        // 出错时清空，避免误展示过期样例
        setHots([])
      }
    }
    loadHots()
  }, [hotTick])

  // 读取最近搜索
  useEffect(() => {
    try {
      const raw = localStorage.getItem('recent_searches')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setRecent(arr.slice(0, 6))
      }
    } catch {}
  }, [])

  // 加载榜单数据
  useEffect(() => {
    const loadRankings = async () => {
      setRankingsLoading(true)
      try {
        // 并行加载所有榜单数据
        const [firstLimitRes, maxGainRes, volumeRes, amountRes] = await Promise.all([
          api.get(`/feeds/rankings/first-limit?limit=3&_t=${Date.now()}`).catch(() => ({ data: { items: [] } })),
          api.get(`/feeds/rankings/max-gain?limit=3&_t=${Date.now()}`).catch(() => ({ data: { items: [] } })),
          api.get(`/feeds/rankings/volume?limit=3&_t=${Date.now()}`).catch(() => ({ data: { items: [] } })),
          api.get(`/feeds/rankings/amount?limit=3&_t=${Date.now()}`).catch(() => ({ data: { items: [] } }))
        ])

        // 处理首板数据
        const firstLimitItems = (firstLimitRes.data?.items || []).map((it: any, index: number) => ({
          ts_code: it.ts_code,
          name: (it.name || '').toString().trim(),
          industry: it.industry || '',
          market: it.exchange || '',
          last_price: it.close != null ? Number(it.close) : undefined,
          change_percent: it.pct_chg != null ? Number(it.pct_chg) : undefined,
          vol: it.vol != null ? Number(it.vol) : undefined,
          amount: it.amount != null ? Number(it.amount) : undefined,
          boards: it.boards != null ? Number(it.boards) : undefined,
          rank: index + 1
        }))

        // 处理最大涨幅数据
        const maxGainItems = (maxGainRes.data?.items || []).map((it: any, index: number) => ({
          ts_code: it.ts_code,
          name: (it.name || '').toString().trim(),
          industry: it.industry || '',
          market: it.exchange || '',
          last_price: it.close != null ? Number(it.close) : undefined,
          change_percent: it.pct_chg != null ? Number(it.pct_chg) : undefined,
          vol: it.vol != null ? Number(it.vol) : undefined,
          amount: it.amount != null ? Number(it.amount) : undefined,
          boards: it.boards != null ? Number(it.boards) : undefined,
          rank: index + 1
        }))

        // 处理成交量数据
        const volumeItems = (volumeRes.data?.items || []).map((it: any, index: number) => ({
          ts_code: it.ts_code,
          name: (it.name || '').toString().trim(),
          industry: it.industry || '',
          market: it.exchange || '',
          last_price: it.close != null ? Number(it.close) : undefined,
          change_percent: it.pct_chg != null ? Number(it.pct_chg) : undefined,
          vol: it.vol != null ? Number(it.vol) : undefined,
          amount: it.amount != null ? Number(it.amount) : undefined,
          boards: it.boards != null ? Number(it.boards) : undefined,
          rank: index + 1
        }))

        // 处理成交额数据
        const amountItems = (amountRes.data?.items || []).map((it: any, index: number) => ({
          ts_code: it.ts_code,
          name: (it.name || '').toString().trim(),
          industry: it.industry || '',
          market: it.exchange || '',
          last_price: it.close != null ? Number(it.close) : undefined,
          change_percent: it.pct_chg != null ? Number(it.pct_chg) : undefined,
          vol: it.vol != null ? Number(it.vol) : undefined,
          amount: it.amount != null ? Number(it.amount) : undefined,
          boards: it.boards != null ? Number(it.boards) : undefined,
          rank: index + 1
        }))

        setFirstLimitStocks(firstLimitItems)
        setMaxGainStocks(maxGainItems)
        setVolumeStocks(volumeItems)
        setAmountStocks(amountItems)
      } catch (e) {
        console.error('Error loading rankings:', e)
      } finally {
        setRankingsLoading(false)
      }
    }
    loadRankings()
  }, [])

  const pushRecent = (items: Array<{ ts_code: string; name: string }>) => {
    try {
      const existing = new Map(recent.map(it => [it.ts_code, it]))
      items.forEach(it => existing.set(it.ts_code, it))
      const next = Array.from(existing.values()).slice(0, 6)
      setRecent(next)
      localStorage.setItem('recent_searches', JSON.stringify(next))
    } catch {}
  }

  const removeRecent = (ts_code: string) => {
    try {
      const next = recent.filter(it => it.ts_code !== ts_code)
      setRecent(next)
      localStorage.setItem('recent_searches', JSON.stringify(next))
    } catch {}
  }

  // 搜索股票
  const handleSearch = async () => {
    if (!searchTerm.trim()) return
    
    console.log('开始搜索:', searchTerm)
    setLoading(true)
    setError(null)
    
    try {
      // 调用搜索API
      console.log('调用搜索API:', `/feeds/search?q=${encodeURIComponent(searchTerm)}`)
      const response = await api.get(`/feeds/search?q=${encodeURIComponent(searchTerm)}`)
      console.log('搜索API响应:', response.data)
      const items = response.data?.items || []
      console.log('搜索结果数量:', items.length)
      if (items.length > 0) {
        pushRecent(items.slice(0, 3).map((it: any) => ({ ts_code: it.ts_code, name: it.name || '' })))
      }
      
      // 为每个搜索结果获取详细信息
      const stocksWithDetails: StockOverview[] = await Promise.all(
        items.map(async (it: any) => {
          try {
            // 获取股票概览数据（包含价格信息）
            const overviewResponse = await api.get(`/feeds/overview/${it.ts_code}`)
            const overview = overviewResponse.data
            
            // 检查数据完整性并触发自动导入
            const needsImport = !overview?.last_price?.close
            if (needsImport) {
              console.log(`股票 ${it.ts_code} 缺少价格数据，触发自动导入...`)
              setImporting(prev => new Set(prev).add(it.ts_code))
              
              try {
                // 触发自动导入
                await api.post(`/feeds/auto-import/${it.ts_code}`)
                console.log(`股票 ${it.ts_code} 自动导入已启动`)
                
                // 等待导入完成，最多等待30秒
                let importComplete = false
                let attempts = 0
                const maxAttempts = 6 // 6次 * 5秒 = 30秒
                
                while (!importComplete && attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 5000))
                  attempts++
                  
                  try {
                    // 检查数据状态
                    const statusResponse = await api.get(`/feeds/data-status/${it.ts_code}`)
                    const status = statusResponse.data
                    
                    console.log(`股票 ${it.ts_code} 数据状态 (${attempts}/${maxAttempts}):`, status)
                    
                    // 如果概览数据已生成，重新获取
                    if (status.has_overview) {
                      const retryResponse = await api.get(`/feeds/overview/${it.ts_code}`)
                      if (retryResponse.data?.last_price?.close) {
                        overview.last_price = retryResponse.data.last_price
                        console.log(`股票 ${it.ts_code} 导入成功，价格: ${overview.last_price.close}`)
                        importComplete = true
                      }
                    }
                  } catch (statusErr) {
                    console.warn(`检查数据状态失败:`, statusErr)
                  }
                }
                
                if (!importComplete) {
                  console.warn(`股票 ${it.ts_code} 导入超时，可能数据源有问题`)
                }
              } catch (importErr) {
                console.warn(`自动导入 ${it.ts_code} 失败:`, importErr)
              } finally {
                setImporting(prev => {
                  const newSet = new Set(prev)
                  newSet.delete(it.ts_code)
                  return newSet
                })
              }
            }
            
            // 获取估值数据
            let valuation = null
            try {
              const valuationResponse = await api.get(`/valuation/${it.ts_code}`)
              valuation = valuationResponse.data
            } catch (valErr) {
              // 估值数据可能不存在，忽略错误
            }
            
            return {
              ts_code: it.ts_code,
              name: (it.name || '').toString().trim(),
              industry: it.industry || '',
              market: it.exchange || '',
              list_date: it.list_date || '',
              last_price: overview?.last_price?.close ? Number(overview.last_price.close) : undefined,
              change_percent: overview?.last_price?.change_percent ? Number(overview.last_price.change_percent) : undefined,
              pe_ratio: valuation?.valuation?.pe_ratio ? Number(valuation.valuation.pe_ratio) : undefined,
              pb_ratio: valuation?.valuation?.pb_ratio ? Number(valuation.valuation.pb_ratio) : undefined,
            }
          } catch (detailErr) {
            // 如果获取详细信息失败，返回基本信息
            return {
              ts_code: it.ts_code,
              name: (it.name || '').toString().trim(),
              industry: it.industry || '',
              market: it.exchange || '',
              list_date: it.list_date || '',
              last_price: undefined,
              change_percent: undefined,
              pe_ratio: undefined,
              pb_ratio: undefined,
            }
          }
        })
      )
      
      console.log('处理后的股票数据:', stocksWithDetails)
      setStocks(stocksWithDetails)
    } catch (err) {
      setError('搜索失败，请稍后重试')
      console.error('Error searching stocks:', err)
      setStocks([])
    } finally {
      setLoading(false)
    }
  }

  // 输入联想：对 1~3 个字符做联想搜索，展示下拉
  useEffect(() => {
    const q = searchTerm.trim()
    if (q.length === 0) {
      setSuggestions([]); setShowSuggest(false); return
    }
    let stopped = false
    const t = setTimeout(async () => {
      try {
        if (q.length <= 3) {
          const resp = await api.get(`/feeds/search?q=${encodeURIComponent(q)}&limit=10`)
          if (stopped) return
          const arr = (resp.data?.items || []).map((it: any) => ({ ts_code: it.ts_code, name: it.name || '' }))
          setSuggestions(arr)
          setShowSuggest(true)
        } else {
          setShowSuggest(false)
        }
      } catch {
        setShowSuggest(false)
      }
    }, 200)
    return () => { stopped = true; clearTimeout(t) }
  }, [searchTerm])

  // 取消兜底样例，热门仅展示后端结果

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          专业的A股分析平台
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          实时K线图表、技术指标分析、智能估值服务
        </p>
      </div>

      {/* 搜索区域 */}
      <div className="max-w-2xl mx-auto">
        <div className="flex space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="输入股票代码或名称，如：600519 或 贵州茅台"
              value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="input pl-10 w-full"
            />
            {/* 联想下拉 */}
            {showSuggest && suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded shadow">
                {suggestions.map(s => (
                  <div
                    key={s.ts_code}
                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer"
                    onClick={() => { setSearchTerm(s.name); setShowSuggest(false); setSuggestions([]); setTimeout(handleSearch, 0) }}
                  >
                    <span className="text-gray-900 mr-2">{s.name}</span>
                    <span className="text-gray-500 text-sm">{s.ts_code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="btn btn-primary px-6"
          >
            {loading ? '搜索中...' : '搜索'}
          </button>
        </div>

        {/* 最近搜索 */}
        {recent.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 text-sm items-center">
            <span className="text-gray-500">最近搜索:</span>
            {recent.map(r => (
              <div key={r.ts_code} className="relative">
                <button
                  className="absolute -left-1 -top-1 p-0.5 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300"
                  onClick={(e) => { e.stopPropagation(); removeRecent(r.ts_code) }}
                  aria-label={`删除 ${r.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
                <button
                  className="badge badge-outline pl-5"
                  onClick={() => { setSearchTerm(r.name); setTimeout(handleSearch, 0) }}
                >
                  {r.name}
                </button>
              </div>
            ))}
          </div>
        )}
        
        {error && (
          <div className="mt-4 p-4 bg-danger-50 border border-danger-200 rounded-md">
            <p className="text-danger-600">{error}</p>
          </div>
        )}
      </div>

      {/* 搜索结果 */}
      {stocks.length > 0 && (
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">搜索结果</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {stocks.map((stock) => (
              <StockCard 
                key={stock.ts_code} 
                stock={stock} 
                isImporting={importing.has(stock.ts_code)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 热门股票推荐 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">热门股票推荐</h2>
          <div className="flex items-center space-x-2">
            <button 
              className="btn btn-outline btn-sm flex items-center space-x-1"
              onClick={() => navigate('/hot-stocks')}
            >
              <MoreHorizontal className="h-4 w-4" />
              <span>更多</span>
            </button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setHotTick(v=>v+1)}>刷新热门</button>
          </div>
        </div>
        {hots.length>0 && (
          <div className="text-xs text-gray-500 mb-4">基于最近交易日：{String(hots[0].list_date).slice(0,10)}</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hots.length === 0 && (
            <div className="col-span-3 text-center text-gray-500">暂无热门数据</div>
          )}
          {hots.map((stock) => (
            <StockCard key={stock.ts_code} stock={stock} compact />
          ))}
        </div>
      </div>

      {/* 股票榜单 */}
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">股票榜单</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StockRankingCard
            title="今日涨停"
            stocks={firstLimitStocks}
            loading={rankingsLoading}
            onMoreClick={() => navigate('/rankings?type=first-limit')}
          />
          <StockRankingCard
            title="最大涨幅"
            stocks={maxGainStocks}
            loading={rankingsLoading}
            onMoreClick={() => navigate('/rankings?type=max-gain')}
          />
          <StockRankingCard
            title="最大成交量"
            stocks={volumeStocks}
            loading={rankingsLoading}
            onMoreClick={() => navigate('/rankings?type=volume')}
          />
          <StockRankingCard
            title="最大成交额"
            stocks={amountStocks}
            loading={rankingsLoading}
            onMoreClick={() => navigate('/rankings?type=amount')}
          />
        </div>
      </div>

      {/* 功能特色 */}
      <div className="bg-white rounded-lg shadow-sm p-8 mt-24 mb-0">
        <h2 className="text-2xl font-semibold text-gray-900 mb-8 text-center">平台特色</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="h-8 w-8 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">实时K线图表</h3>
            <p className="text-gray-600">专业的K线图表展示，支持多种技术指标分析</p>
          </div>
          
          <div className="text-center">
            <div className="bg-success-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calculator className="h-8 w-8 text-success-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">智能估值分析</h3>
            <p className="text-gray-600">基于PE/PB等指标的智能估值分析，提供投资建议</p>
          </div>
          
          <div className="text-center">
            <div className="bg-warning-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="h-8 w-8 text-warning-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">AI智能评分</h3>
            <p className="text-gray-600">基于机器学习的AI评分系统，提供可解释的投资建议</p>
          </div>
        </div>
      </div>
    </div>
  )
}











