import React from 'react'
import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

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

interface StockRankingCardProps {
  title: string
  stocks: StockRankingItem[]
  onMoreClick: () => void
  loading?: boolean
}

export const StockRankingCard: React.FC<StockRankingCardProps> = ({ 
  title, 
  stocks, 
  onMoreClick, 
  loading = false 
}) => {
  const navigate = useNavigate()
  
  const handleStockClick = (tsCode: string) => {
    navigate(`/stock/${tsCode}`)
  }

  const formatPrice = (price?: number) => {
    if (!price) return '--'
    return price.toFixed(2)
  }

  const formatPercent = (percent?: number) => {
    if (percent === undefined) return '--'
    const sign = percent >= 0 ? '+' : ''
    return `${sign}${percent.toFixed(2)}%`
  }

  const formatVolume = (vol?: number) => {
    if (!vol) return '--'
    if (vol >= 100000000) return `${(vol / 100000000).toFixed(1)}亿`
    if (vol >= 10000) return `${(vol / 10000).toFixed(1)}万`
    return vol.toString()
  }

  const formatAmount = (amount?: number) => {
    if (!amount) return '--'
    if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}亿`
    if (amount >= 10000) return `${(amount / 10000).toFixed(1)}万`
    return amount.toString()
  }

  const getPriceColor = (percent?: number) => {
    if (percent === undefined) return 'price-neutral'
    if (percent > 0) return 'price-up'
    if (percent < 0) return 'price-down'
    return 'price-neutral'
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex justify-between items-center">
          <h3 className="card-title text-lg">{title}</h3>
          <button 
            className="btn btn-outline btn-sm flex items-center space-x-1"
            onClick={onMoreClick}
          >
            <span>更多</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      
      <div className="card-content">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-3">
                    <div className="w-6 h-6 bg-gray-200 rounded"></div>
                    <div className="h-4 bg-gray-200 rounded w-20"></div>
                    <div className="h-3 bg-gray-200 rounded w-16"></div>
                  </div>
                  <div className="h-4 bg-gray-200 rounded w-16"></div>
                </div>
              </div>
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <div className="text-center text-gray-500 py-4">暂无数据</div>
        ) : (
          <div className="space-y-3">
            {stocks.map((stock) => (
              <div 
                key={stock.ts_code}
                className="flex justify-between items-center p-2 hover:bg-gray-50 rounded cursor-pointer transition-colors"
                onClick={() => handleStockClick(stock.ts_code)}
              >
                <div className="flex items-center space-x-3">
                  <div className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 rounded-full text-sm font-medium">
                    {stock.rank}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{stock.name}</div>
                    <div className="text-xs text-gray-500">{stock.ts_code}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">¥{formatPrice(stock.last_price)}</div>
                  <div className={`text-xs ${getPriceColor(stock.change_percent)}`}>
                    {formatPercent(stock.change_percent)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
