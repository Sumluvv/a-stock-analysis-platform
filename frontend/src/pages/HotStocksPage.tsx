import React, { useState, useEffect } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { StockCard } from '../components/StockCard'
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

export const HotStocksPage: React.FC = () => {
  const navigate = useNavigate()
  const [hots, setHots] = useState<StockOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const limit = 20 // 每页显示20只股票

  // 加载热门股票
  const loadHotStocks = async (pageNum: number = 1, isRefresh: boolean = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true)
      } else if (pageNum === 1) {
        setLoading(true)
      }
      
      setError(null)
      
      const offset = (pageNum - 1) * limit
      const resp = await api.get(`/feeds/hot?limit=${limit}&offset=${offset}&_t=${Date.now()}`)
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

      if (pageNum === 1) {
        setHots(mapped)
      } else {
        setHots(prev => [...prev, ...mapped])
      }
      
      setHasMore(items.length === limit)
      setPage(pageNum)
      
    } catch (e) {
      setError('加载热门股票失败，请稍后重试')
      console.error('Error loading hot stocks:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // 初始加载
  useEffect(() => {
    loadHotStocks(1)
  }, [])

  // 刷新热门股票
  const handleRefresh = () => {
    loadHotStocks(1, true)
  }

  // 加载更多
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadHotStocks(page + 1)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 页面头部 */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/')}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
                <span>返回首页</span>
              </button>
              <h1 className="text-3xl font-bold text-gray-900">热门股票推荐</h1>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn btn-outline btn-sm flex items-center space-x-2"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? '刷新中...' : '刷新'}</span>
            </button>
          </div>
          
          {hots.length > 0 && (
            <div className="text-sm text-gray-500">
              基于最近交易日：{String(hots[0].list_date).slice(0, 10)}
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* 加载状态 */}
        {loading && hots.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">加载中...</span>
          </div>
        )}

        {/* 热门股票列表 */}
        {hots.length > 0 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {hots.map((stock) => (
                <StockCard key={stock.ts_code} stock={stock} />
              ))}
            </div>

            {/* 加载更多按钮 */}
            {hasMore && (
              <div className="text-center pt-8">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="btn btn-outline btn-lg px-8"
                >
                  {loading ? '加载中...' : '加载更多'}
                </button>
              </div>
            )}

            {/* 没有更多数据 */}
            {!hasMore && hots.length > 0 && (
              <div className="text-center py-8 text-gray-500">
                已显示全部热门股票
              </div>
            )}
          </div>
        )}

        {/* 空状态 */}
        {!loading && hots.length === 0 && !error && (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg">暂无热门股票数据</div>
            <button
              onClick={handleRefresh}
              className="btn btn-primary mt-4"
            >
              重新加载
            </button>
          </div>
        )}
      </div>
    </div>
  )
}




