import React, { useEffect, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { api } from '../utils/api'

interface KLineData {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

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

interface KLineChartProps {
  tsCode: string
  // 可选：自定义高度（像素）。默认 560，更适合桌面浏览体验
  height?: number
  // 是否显示AI预测
  aiEnabled?: boolean
  // 预测步数
  predLen?: number
  // 是否显示置信带（上/下界面积）
  showBand?: boolean
  // 第一阶段：可选MACD副图
  showMACD?: boolean
  showRSI?: boolean
  showBOLL?: boolean
  showMAsubplot?: boolean
}

export const KLineChart: React.FC<KLineChartProps> = ({ tsCode, height, aiEnabled = false, predLen = 20, showBand = true, showMACD = true, showRSI = true, showBOLL = true, showMAsubplot = true }) => {
  const [klineData, setKlineData] = useState<KLineData[]>([])
  const [indicators, setIndicators] = useState<TechnicalIndicator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const numSubs = (showMACD?1:0) + (showRSI?1:0) + (showBOLL?1:0) + (showMAsubplot?1:0)
  const chartHeight = Math.max(360, Number(height ?? (640 + numSubs*140)))
  const [forecast, setForecast] = useState<Array<{ date: string; open?: number; high?: number; low?: number; close: number }>>([])
  const [forecastError, setForecastError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // 后端返回: { ts_code, freq, prices, indicators }
        const resp = await api.get(`/feeds/kline/${tsCode}`)
        const payload = resp.data || {}

        const rawPrices = payload.prices || payload.data?.prices || []
        const rawIndicators = payload.indicators || payload.data?.indicators || []

        const mappedPrices: KLineData[] = rawPrices.map((p: any) => ({
          date: (p.trade_date || p.date || '').toString().slice(0, 10),
          open: Number(p.open ?? 0),
          close: Number(p.close ?? 0),
          high: Number(p.high ?? 0),
          low: Number(p.low ?? 0),
          volume: Number(p.vol ?? p.volume ?? 0),
        }))

        const mappedIndicators: TechnicalIndicator[] = rawIndicators.map((t: any) => ({
          date: (t.trade_date || t.date || '').toString().slice(0, 10),
          ma5: t.ma5,
          ma10: t.ma10,
          ma20: t.ma20,
          ma60: t.ma60,
          macd: t.macd,
          macd_signal: t.macd_signal,
          macd_histogram: t.macd_hist ?? t.macd_histogram,
          rsi: t.rsi14 ?? t.rsi6 ?? t.rsi,
          boll_upper: t.boll_upper,
          boll_middle: t.boll_mid ?? t.boll_middle,
          boll_lower: t.boll_lower,
        }))

        setKlineData(mappedPrices)
        setIndicators(mappedIndicators)
      } catch (err) {
        setError('获取K线数据失败')
        console.error('Error fetching kline data:', err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [tsCode])

  useEffect(() => {
    const loadForecast = async () => {
      if (!aiEnabled || klineData.length === 0) {
        setForecast([])
        setForecastError(null)
        return
      }
      try {
        const resp = await api.get(`/feeds/ai/forecast/${tsCode}?pred_len=${predLen}`)
        const items = (resp.data?.predictions || []).map((p: any) => ({
          date: (p.date || '').toString().slice(0, 10),
          open: p.open != null ? Number(p.open) : undefined,
          high: p.high != null ? Number(p.high) : undefined,
          low: p.low != null ? Number(p.low) : undefined,
          close: Number(p.close ?? p.open ?? 0)
        }))
        setForecast(items)
        setForecastError(null)
      } catch (err) {
        console.warn('AI 预测不可用：', err)
        setForecast([])
        setForecastError('AI预测不可用（预测服务未启动或网络异常）')
      }
    }
    loadForecast()
  }, [aiEnabled, predLen, tsCode, klineData.length])

  const getOption = () => {
    if (klineData.length === 0) return {}

    // 准备K线数据
    const dates = klineData.map(item => item.date)
    // ECharts蜡烛默认格式: [open, close, low, high]
    const ohlcData = klineData.map(item => [item.open, item.close, item.low, item.high])
    const volumeData = klineData.map(item => item.volume)

    // 准备技术指标数据
    const ma5Data = indicators.map(item => item.ma5).filter(val => val !== undefined)
    const ma10Data = indicators.map(item => item.ma10).filter(val => val !== undefined)
    const ma20Data = indicators.map(item => item.ma20).filter(val => val !== undefined)
    const ma60Data = indicators.map(item => item.ma60).filter(val => val !== undefined)

    // 预测线
    const forecastDates = forecast.map(f => f.date)
    const forecastValues = forecast.map(f => f.close)
    const forecastUpper = forecast.map(f => (f.high ?? f.close))
    const forecastLower = forecast.map(f => (f.low ?? f.close))

    // 计算各副图顶部位置（百分比数值）以用于 grid 与小标题对齐
    // 给主图x轴标签预留空间，适当下移成交量副图，避免柱子顶到主图标签
    const volumeTopPct = numSubs > 0 ? 52 : 84
    const subGridTops: number[] = [volumeTopPct]
    let accTop = 64
    if (showMACD) { subGridTops.push(accTop); accTop += 12 }
    if (showRSI)  { subGridTops.push(accTop); accTop += 12 }
    if (showBOLL) { subGridTops.push(accTop); accTop += 12 }
    if (showMAsubplot) { subGridTops.push(accTop); accTop += 12 }

    const subTitles: string[] = [
      '成交量',
      ...(showMACD ? ['MACD'] : []),
      ...(showRSI ? ['RSI'] : []),
      ...(showBOLL ? ['BOLL'] : []),
      ...(showMAsubplot ? ['MA副图'] : [])
    ]

    return {
      title: [
        {
          text: `${tsCode} K线图`,
          left: 'center',
          top: 6,
          textStyle: { fontSize: 16, fontWeight: 'bold' }
        },
        ...subGridTops.map((topPct, idx) => ({
          text: subTitles[idx] || '',
          left: '4%',
          top: `${topPct + 1}%`,
          textStyle: { fontSize: 11, color: '#64748b', fontWeight: 500 }
        }))
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        },
        formatter: function (params: any) {
          let result = `${params[0].axisValue}<br/>`
          params.forEach((param: any) => {
            if (param.seriesName === 'K线') {
              const data = param.data
              // data: [open, close, low, high]
              result += `开盘: ${Number(data[0]).toFixed(2)}<br/>`
              result += `收盘: ${Number(data[1]).toFixed(2)}<br/>`
              result += `最低: ${Number(data[2]).toFixed(2)}<br/>`
              result += `最高: ${Number(data[3]).toFixed(2)}<br/>`
            } else if (param.seriesName === '成交量') {
              result += `成交量: ${param.data.toLocaleString()}<br/>`
            } else {
              result += `${param.seriesName}: ${Number(param.data).toFixed(2)}<br/>`
            }
          })
          return result
        }
      },
      legend: {
        data: [
          'K线','MA5','MA10','MA20','MA60','成交量',
          ...(showMACD ? ['MACD柱','MACD','MACD信号'] : []),
          ...(showRSI ? ['RSI'] : []),
          ...(showBOLL ? ['BOLL上','BOLL中','BOLL下'] : []),
          ...(showMAsubplot ? ['副图MA5','副图MA10','副图MA20'] : []),
          ...(forecast.length ? ['AI预测'] : []),
          ...(forecast.length && showBand ? ['AI上界','AI下界'] : [])
        ],
        top: 30
      },
      grid: (() => {
        const arr: any[] = []
        arr.push({ left: '3%', right: '4%', height: numSubs>0 ? '44%' : '68%' })
        arr.push({ left: '3%', right: '4%', top: `${volumeTopPct}%`, height: '12%' })
        let top = 64
        if (showMACD) { arr.push({ left:'3%', right:'4%', top: `${top}%`, height:'12%' }); top += 12 }
        if (showRSI)  { arr.push({ left:'3%', right:'4%', top: `${top}%`, height:'12%' }); top += 12 }
        if (showBOLL) { arr.push({ left:'3%', right:'4%', top: `${top}%`, height:'12%' }); top += 12 }
        if (showMAsubplot){ arr.push({ left:'3%', right:'4%', top: `${top}%`, height:'12%' }); top += 12 }
        return arr
      })(),
      xAxis: (() => {
        const axes: any[] = []
        // 主图显示日期
        axes.push({ type:'category', data:[...dates,...forecastDates], scale:true, boundaryGap:false, axisLine:{onZero:false, show:true}, axisTick:{show:true}, splitLine:{show:false}, axisLabel:{ show:true, margin: 10 }, min:'dataMin', max:'dataMax' })
        axes.push({ type:'category', gridIndex:1, data:[...dates,...forecastDates], scale:true, boundaryGap:false, axisLine:{onZero:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false}, min:'dataMin', max:'dataMax' })
        let idx = 2
        const pushAxis = () => axes.push({ type:'category', gridIndex: idx++, data:[...dates,...forecastDates], scale:true, boundaryGap:false, axisLine:{onZero:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false}, min:'dataMin', max:'dataMax' })
        if (showMACD) pushAxis()
        if (showRSI) pushAxis()
        if (showBOLL) pushAxis()
        if (showMAsubplot) pushAxis()
        // 仅主图显示日期，其余副图隐藏
        return axes
      })(),
      yAxis: (() => {
        const ys: any[] = []
        ys.push({ scale:true, splitArea:{show:true} })
        ys.push({ scale:true, gridIndex:1, splitNumber:2, axisLabel:{show:false}, axisLine:{show:false}, axisTick:{show:false}, splitLine:{show:false}, max: Math.max(1, ...volumeData) * 1.15 })
        let idx = 2
        const pushY = () => ys.push({ scale:true, gridIndex: idx++, splitNumber:3, axisLabel:{show:false}, axisLine:{show:false}, axisTick:{show:false}, splitLine:{show:false} })
        if (showMACD) pushY()
        if (showRSI) pushY()
        if (showBOLL) pushY()
        if (showMAsubplot) pushY()
        return ys
      })(),
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: Array.from({length: 2 + numSubs}, (_,i)=>i),
          start: 70,
          end: 100
        },
        {
          show: true,
          xAxisIndex: Array.from({length: 2 + numSubs}, (_,i)=>i),
          type: 'slider',
          bottom: 6,
          start: 70,
          end: 100
        }
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: ohlcData,
          itemStyle: {
            color: '#ef4444',
            color0: '#22c55e',
            borderColor: '#ef4444',
            borderColor0: '#22c55e'
          }
        },
        {
          name: 'MA5',
          type: 'line',
          data: ma5Data,
          smooth: true,
          lineStyle: {
            width: 1,
            color: '#3b82f6'
          }
        },
        {
          name: 'MA10',
          type: 'line',
          data: ma10Data,
          smooth: true,
          lineStyle: {
            width: 1,
            color: '#f59e0b'
          }
        },
        {
          name: 'MA20',
          type: 'line',
          data: ma20Data,
          smooth: true,
          lineStyle: {
            width: 1,
            color: '#8b5cf6'
          }
        },
        {
          name: 'MA60',
          type: 'line',
          data: ma60Data,
          smooth: true,
          lineStyle: {
            width: 1,
            color: '#06b6d4'
          }
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumeData,
          itemStyle: {
            color: function(params: any) {
              const dataIndex = params.dataIndex
              if (dataIndex === 0) return '#999'
              const current = klineData[dataIndex]
              const previous = klineData[dataIndex - 1]
              return current.close >= previous.close ? '#22c55e' : '#ef4444'
            }
          }
        },
        ...(showMACD ? [
          { name: 'MACD柱', type: 'bar', xAxisIndex: 2, yAxisIndex: 2, data: indicators.map(i => i.macd_histogram ?? 0), itemStyle: { color: (v:any)=> (v.value>=0?'#22c55e':'#ef4444') } },
          { name: 'MACD', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: indicators.map(i => i.macd ?? null), lineStyle: { width: 1, color: '#0ea5e9' }, showSymbol: false },
          { name: 'MACD信号', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: indicators.map(i => i.macd_signal ?? null), lineStyle: { width: 1, color: '#6366f1' }, showSymbol: false }
        ] : []),
        ...(showRSI ? [
          { name: 'RSI', type: 'line', xAxisIndex: 2 + (showMACD?1:0), yAxisIndex: 2 + (showMACD?1:0), data: indicators.map(i => i.rsi ?? null), lineStyle: { width:1, color:'#10b981' }, showSymbol:false }
        ] : []),
        ...(showBOLL ? [
          { name:'BOLL上', type:'line', xAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0), yAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0), data: indicators.map(i=> i.boll_upper ?? null), lineStyle:{width:1,color:'#f43f5e'}, showSymbol:false },
          { name:'BOLL中', type:'line', xAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0), yAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0), data: indicators.map(i=> i.boll_middle ?? null), lineStyle:{width:1,color:'#64748b'}, showSymbol:false },
          { name:'BOLL下', type:'line', xAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0), yAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0), data: indicators.map(i=> i.boll_lower ?? null), lineStyle:{width:1,color:'#3b82f6'}, showSymbol:false }
        ] : []),
        ...(showMAsubplot ? [
          { name:'副图MA5', type:'line', xAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0) + (showBOLL?1:0), yAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0) + (showBOLL?1:0), data: indicators.map(i=> i.ma5 ?? null), lineStyle:{width:1,color:'#3b82f6'}, showSymbol:false },
          { name:'副图MA10', type:'line', xAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0) + (showBOLL?1:0), yAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0) + (showBOLL?1:0), data: indicators.map(i=> i.ma10 ?? null), lineStyle:{width:1,color:'#f59e0b'}, showSymbol:false },
          { name:'副图MA20', type:'line', xAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0) + (showBOLL?1:0), yAxisIndex: 2 + (showMACD?1:0) + (showRSI?1:0) + (showBOLL?1:0), data: indicators.map(i=> i.ma20 ?? null), lineStyle:{width:1,color:'#8b5cf6'}, showSymbol:false }
        ] : []),
        ...(forecast.length ? [
          {
            name: 'AI预测',
            type: 'line',
            data: new Array(dates.length - 1).fill(null).concat([klineData[dates.length - 1]?.close, ...forecastValues]),
            smooth: true,
            lineStyle: { width: 2, type: 'dashed', color: '#0ea5e9' },
            showSymbol: false
          },
          ...(showBand ? [
            {
              name: 'AI上界',
              type: 'line',
              data: new Array(dates.length).fill(null).concat(forecastUpper),
              lineStyle: { width: 1, color: '#38bdf8' },
              areaStyle: { color: 'rgba(56,189,248,0.12)' },
              showSymbol: false
            },
            {
              name: 'AI下界',
              type: 'line',
              data: new Array(dates.length).fill(null).concat(forecastLower),
              lineStyle: { width: 1, color: '#60a5fa' },
              areaStyle: { color: 'rgba(96,165,250,0.12)' },
              showSymbol: false
            }
          ] : [])
        ] : [])
      ]
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="loading-spinner"></div>
        <span className="ml-3 text-gray-600">加载K线数据中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96 text-red-600">
        <p>{error}</p>
      </div>
    )
  }

  if (klineData.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        <p>暂无K线数据</p>
      </div>
    )
  }

  return (
    <div className="chart-container" style={{ height: chartHeight }}>
      {aiEnabled && forecastError && (
        <div className="mb-2 p-2 text-sm rounded border border-yellow-300 bg-yellow-50 text-yellow-800">
          {forecastError}
        </div>
      )}
      <ReactECharts
        option={getOption()}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}
