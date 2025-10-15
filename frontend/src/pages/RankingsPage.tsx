import React, { useState, useEffect } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { StockRankingCard } from '../components/StockRankingCard'
import { api } from '../utils/api'

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
  turnover_rate?: number
  volume_ratio?: number
  total_mv?: number
  circ_mv?: number
  hot_score?: number
}

type RankingType = 'first-limit' | 'max-gain' | 'volume' | 'amount'

// 格式化成交量
const formatVolume = (vol: number): string => {
  if (vol >= 100000000) {
    return `${(vol / 100000000).toFixed(1)}亿手`
  } else if (vol >= 10000) {
    return `${(vol / 10000).toFixed(1)}万手`
  } else {
    return `${vol.toFixed(0)}手`
  }
}

// 格式化成交额/市值
const formatAmount = (amount: number): string => {
  if (amount >= 100000000) {
    return `${(amount / 100000000).toFixed(1)}亿`
  } else if (amount >= 10000) {
    return `${(amount / 10000).toFixed(1)}万`
  } else {
    return `${amount.toFixed(0)}`
  }
}

const RANKING_CONFIG = {
  'first-limit': {
    title: '今日涨停',
    description: '今日涨停的股票',
    apiPath: '/feeds/rankings/first-limit'
  },
  'max-gain': {
    title: '最大涨幅',
    description: '涨幅最大的股票',
    apiPath: '/feeds/rankings/max-gain'
  },
  'volume': {
    title: '最大成交量',
    description: '成交量最大的股票',
    apiPath: '/feeds/rankings/volume'
  },
  'amount': {
    title: '最大成交额',
    description: '成交额最大的股票',
    apiPath: '/feeds/rankings/amount'
  }
}

export const RankingsPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const type = (searchParams.get('type') as RankingType) || 'first-limit'
  
  const [stocks, setStocks] = useState<StockRankingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const config = RANKING_CONFIG[type]

  // 加载榜单数据
  const loadRankings = async (isRefresh: boolean = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      
      setError(null)
      
      const resp = await api.get(`${config.apiPath}?limit=50&_t=${Date.now()}`)
      const items = resp.data?.items || []
      
      const mapped: StockRankingItem[] = items.map((it: any, index: number) => ({
        ts_code: it.ts_code,
        name: (it.name || '').toString().trim(),
        industry: it.industry || '',
        market: it.exchange || '',
        last_price: it.close != null ? Number(it.close) : undefined,
        change_percent: it.pct_chg != null ? Number(it.pct_chg) : undefined,
        vol: it.vol != null ? Number(it.vol) : undefined,
        amount: it.amount != null ? Number(it.amount) : undefined,
        boards: it.boards != null ? Number(it.boards) : undefined,
        rank: index + 1,
        turnover_rate: it.turnover_rate != null ? Number(it.turnover_rate) : undefined,
        volume_ratio: it.volume_ratio != null ? Number(it.volume_ratio) : undefined,
        total_mv: it.total_mv != null ? Number(it.total_mv) : undefined,
        circ_mv: it.circ_mv != null ? Number(it.circ_mv) : undefined,
        hot_score: it.hot_score != null ? Number(it.hot_score) : undefined
      }))

      setStocks(mapped)
      
    } catch (e) {
      setError('加载榜单数据失败，请稍后重试')
      console.error('Error loading rankings:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // 初始加载
  useEffect(() => {
    loadRankings()
  }, [type])

  // 刷新榜单
  const handleRefresh = () => {
    loadRankings(true)
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
        </div>

        {/* 榜单类型切换 */}
        <div className="mb-6">
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
            {Object.entries(RANKING_CONFIG).map(([key, config]) => (
              <button
                key={key}
                onClick={() => navigate(`/rankings?type=${key}`)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  type === key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {config.title}
              </button>
            ))}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* 榜单列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">加载中...</span>
          </div>
        ) : stocks.length > 0 ? (
          <div className="space-y-4">
            {stocks.map((stock) => (
              <div 
                key={stock.ts_code}
                className="bg-white rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/stock/${stock.ts_code}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-600 rounded-full font-medium">
                      {stock.rank}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{stock.name}</div>
                      <div className="text-sm text-gray-500">{stock.ts_code} · {stock.industry}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">¥{stock.last_price?.toFixed(2) || '--'}</div>
                    {stock.boards && stock.boards > 1 && (
                      <div className="text-xs text-orange-600">{stock.boards}连板</div>
                    )}
                  </div>
                </div>
                
                {/* 详细数据行 */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-gray-500 mb-1">成交量</div>
                      <div className="font-medium text-gray-900">
                        {stock.vol ? formatVolume(stock.vol) : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">成交额</div>
                      <div className="font-medium text-gray-900">
                        {stock.amount ? formatAmount(stock.amount) : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">换手率</div>
                      <div className="font-medium text-gray-900">
                        {stock.turnover_rate ? `${stock.turnover_rate.toFixed(2)}%` : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">量比</div>
                      <div className="font-medium text-gray-900">
                        {stock.volume_ratio ? stock.volume_ratio.toFixed(2) : '--'}
                      </div>
                    </div>
                  </div>
                  
                  {/* 第二行数据 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-3">
                    <div>
                      <div className="text-gray-500 mb-1">总市值</div>
                      <div className="font-medium text-gray-900">
                        {stock.total_mv ? formatAmount(stock.total_mv) : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">流通市值</div>
                      <div className="font-medium text-gray-900">
                        {stock.circ_mv ? formatAmount(stock.circ_mv) : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">涨跌幅</div>
                      <div className={`font-medium ${stock.change_percent && stock.change_percent > 0 ? 'text-red-600' : stock.change_percent && stock.change_percent < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                        {stock.change_percent ? `${stock.change_percent > 0 ? '+' : ''}${stock.change_percent.toFixed(2)}%` : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">行业</div>
                      <div className="font-medium text-gray-900">
                        {stock.industry || '--'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg">暂无榜单数据</div>
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
