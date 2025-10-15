import React from 'react'
import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

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

interface StockCardProps {
  stock: StockOverview
  isImporting?: boolean
  compact?: boolean // 热门卡片使用：隐藏估值信息，整体更紧凑
}

export const StockCard: React.FC<StockCardProps> = ({ stock, isImporting = false, compact = false }) => {
  const navigate = useNavigate()
  
  const handleClick = () => {
    navigate(`/stock/${stock.ts_code}`)
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

  const getPriceColor = (percent?: number) => {
    if (percent === undefined) return 'price-neutral'
    if (percent > 0) return 'price-up'
    if (percent < 0) return 'price-down'
    return 'price-neutral'
  }

  return (
    <div 
      className={`card card-hover cursor-pointer ${compact ? 'p-4' : ''}`}
      onClick={handleClick}
    >
      <div className="card-header">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="card-title text-lg">{stock.name}</h3>
            <p className="text-sm text-gray-500">{stock.ts_code}</p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-400" />
        </div>
        <p className="text-sm text-gray-600">{stock.industry} · {stock.market}</p>
      </div>
      
      <div className="card-content">
        <div className="space-y-3">
          {/* 价格信息 */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">最新价</span>
            <div className="flex items-center space-x-2">
              {isImporting ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-sm text-blue-600">导入中...</span>
                </div>
              ) : (
                <>
                  <span className="text-lg font-semibold">
                    ¥{formatPrice(stock.last_price)}
                  </span>
                  {stock.change_percent !== undefined && (
                    <div className={`flex items-center space-x-1 ${getPriceColor(stock.change_percent)}`}>
                      {stock.change_percent >= 0 ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                      <span className="text-sm font-medium">
                        {formatPercent(stock.change_percent)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* 估值信息（热门卡片隐藏） */}
          {!compact && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-600">PE比率</span>
                <p className="text-lg font-semibold">
                  {stock.pe_ratio ? stock.pe_ratio.toFixed(2) : '--'}
                </p>
              </div>
              <div>
                <span className="text-sm text-gray-600">PB比率</span>
                <p className="text-lg font-semibold">
                  {stock.pb_ratio ? stock.pb_ratio.toFixed(2) : '--'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className={`card-footer ${compact ? 'pt-3' : ''}`}>
        <button className="btn btn-outline btn-sm w-full">
          查看详情
        </button>
      </div>
    </div>
  )
}

