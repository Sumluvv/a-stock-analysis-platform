import React, { useState, useEffect } from 'react'
import { Calculator, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react'
import { api } from '../utils/api'

interface ValuationData {
  ts_code: string
  as_of_date: string
  method: string
  current_price: number
  financials: {
    eps: number
    bps: number
    roe: number
    revenue: number
    net_profit: number
    latest_period: string
  }
  valuation: {
    pe_ratio: number
    pb_ratio: number
    pe_implied_price: number
    pb_implied_price: number
  }
  analysis: {
    pe_analysis: string
    pb_analysis: string
    overall_assessment: string
  }
  created_at: string
}

interface ValuationPanelProps {
  tsCode: string
}

export const ValuationPanel: React.FC<ValuationPanelProps> = ({ tsCode }) => {
  const [valuation, setValuation] = useState<ValuationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 新增：方法与参数
  const [methods, setMethods] = useState<Array<any>>([])
  // 从 URL 参数恢复方法（valMethod），默认 PE
  const initialMethod = (typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('valMethod') as any) : null) || 'PE'
  const [activeMethod, setActiveMethod] = useState<'PE'|'PB'|'PEG'|'EVEBITDA'>(initialMethod)
  const [params, setParams] = useState<Record<string, any>>({})
  const [calcResult, setCalcResult] = useState<any>(null)
  const [calcLoading, setCalcLoading] = useState(false)

  // 恢复参数：优先 URL(vm_*), 其次 localStorage，其它用 defaults
  const restoreParams = (code: string, method: string, defaults: any) => {
    const urlObj: Record<string, any> = {}
    const sp = (typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams())
    sp.forEach((v,k)=>{ if (k.startsWith('vm_')) urlObj[k.slice(3)] = Number(v) })
    const key = `valuation_params:${code}:${method}`
    const ls = (typeof window !== 'undefined') ? localStorage.getItem(key) : null
    const saved = ls ? JSON.parse(ls) : null
    return { ...defaults, ...(saved||{}), ...(Object.keys(urlObj).length?urlObj:{}) }
  }

  // 持久化到 URL + localStorage
  const persistParams = (code: string, method: string, p: Record<string, any>) => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    sp.set('valMethod', method)
    Object.entries(p).forEach(([k,v]) => sp.set(`vm_${k}`, String(v)))
    const url = `${window.location.pathname}?${sp.toString()}`
    window.history.replaceState(null, '', url)
    localStorage.setItem(`valuation_params:${code}:${method}`, JSON.stringify(p))
  }

  const getCurrentMethod = () => methods.find((m:any)=>m.key===activeMethod)

  const resetDefaults = () => {
    const m = getCurrentMethod()
    if (m) {
      setParams(m.defaults || {})
      setCalcResult(null)
      persistParams(tsCode, activeMethod, m.defaults || {})
    }
  }

  const copyShareLink = async () => {
    try {
      if (typeof window === 'undefined') return
      await navigator.clipboard.writeText(window.location.href)
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        copyShareLink()
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }
  }, [activeMethod, params])

  useEffect(() => {
    const fetchValuation = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await api.get(`/valuation/${tsCode}`)
        setValuation(response.data)
      } catch (err) {
        setError('获取估值数据失败')
        console.error('Error fetching valuation:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchValuation()
  }, [tsCode])

  useEffect(() => {
    const fetchMethods = async () => {
      try {
        const resp = await api.get(`/valuation/methods/${tsCode}`)
        const list = resp.data?.methods || []
        setMethods(list)
        const urlMethod = (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('valMethod') : null) || 'PE'
        const m = list.find((x:any)=>x.key===urlMethod.toUpperCase()) || list.find((x:any)=>x.key==='PE')
        if (m) { setParams(restoreParams(tsCode, m.key, m.defaults)); setActiveMethod(m.key) }
      } catch (e) {}
    }
    fetchMethods()
  }, [tsCode])

  const getAssessmentColor = (assessment: string) => {
    if (assessment.includes('合理') || assessment.includes('值得关注')) {
      return 'text-success-600 bg-success-50'
    }
    if (assessment.includes('偏高') || assessment.includes('谨慎')) {
      return 'text-warning-600 bg-warning-50'
    }
    if (assessment.includes('过高') || assessment.includes('风险')) {
      return 'text-danger-600 bg-danger-50'
    }
    return 'text-gray-600 bg-gray-50'
  }

  const getAssessmentIcon = (assessment: string) => {
    if (assessment.includes('合理') || assessment.includes('值得关注')) {
      return <CheckCircle className="h-4 w-4" />
    }
    if (assessment.includes('偏高') || assessment.includes('谨慎')) {
      return <AlertTriangle className="h-4 w-4" />
    }
    if (assessment.includes('过高') || assessment.includes('风险')) {
      return <TrendingDown className="h-4 w-4" />
    }
    return <TrendingUp className="h-4 w-4" />
  }

  const runCalc = async () => {
    try {
      setCalcLoading(true)
      const body = { method: activeMethod, ...params }
      const resp = await api.post(`/valuation/calc/${tsCode}`, body)
      setCalcResult(resp.data)
      // 计算成功后持久化
      persistParams(tsCode, activeMethod, params)
    } catch (e) {
      console.error('calc failed', e)
    } finally {
      setCalcLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2">
            <Calculator className="h-5 w-5 text-primary-600" />
            <h2 className="card-title">估值分析</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" title="复制分享链接 (Ctrl/⌘+Shift+C)" onClick={copyShareLink}>复制链接</button>
              <button className="btn btn-outline btn-sm" onClick={resetDefaults}>重置默认参数</button>
            </div>
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

  if (error || !valuation) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2">
              <Calculator className="h-5 w-5 text-primary-600" />
              <h2 className="card-title">估值分析</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" title="复制分享链接 (Ctrl/⌘+Shift+C)" onClick={()=>{if((navigator as any)?.clipboard){(navigator as any).clipboard.writeText(window.location.href).catch(()=>{})}}}>复制链接</button>
              <button className="btn btn-outline btn-sm" onClick={()=>{const m=methods.find((x:any)=>x.key===activeMethod); if(m){ setParams(m.defaults||{}); setCalcResult(null);} }}>重置默认参数</button>
            </div>
          </div>
        </div>
        <div className="card-content">
          <div className="text-center text-gray-500 py-8">
            <p>{error || '暂无估值数据'}</p>
          </div>
        </div>
      </div>
    )
  }

  const renderParamField = (key: string, label: string, step=0.01) => (
    <div className="text-sm space-y-1">
      <div className="text-gray-600">{label}</div>
      <input
        type="number"
        step={step}
        className="input input-sm w-full"
        value={params[key] ?? ''}
        onChange={(e)=>{ const next = { ...params, [key]: Number(e.target.value) }; setParams(next); persistParams(tsCode, activeMethod, next) }}
      />
    </div>
  )

  const MethodTab = ({m}:{m:any}) => (
    <button
      className={`px-3 py-1 rounded ${activeMethod===m.key?'bg-primary-600 text-white':'bg-gray-100 text-gray-700'}`}
      onClick={()=>{ 
        setActiveMethod(m.key); 
        setParams(restoreParams(tsCode, m.key, m.defaults || {})); 
        setCalcResult(null);
        // 把方法写入URL，参数随后由表单变更或计算时同步
        if (typeof window !== 'undefined'){
          const sp = new URLSearchParams(window.location.search); 
          sp.set('valMethod', m.key); 
          window.history.replaceState(null,'',`${window.location.pathname}?${sp.toString()}`)
        }
      }}
    >{m.name}</button>
  )

  return (
    <div className="space-y-6">
      {/* 估值分析卡片 */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2">
              <Calculator className="h-5 w-5 text-primary-600" />
              <h2 className="card-title">估值分析</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" title="复制分享链接 (Ctrl/⌘+Shift+C)" onClick={()=>{if((navigator as any)?.clipboard){(navigator as any).clipboard.writeText(window.location.href).catch(()=>{})}}}>复制链接</button>
              <button className="btn btn-outline btn-sm" onClick={()=>{const m=methods.find((x:any)=>x.key===activeMethod); if(m){ setParams(m.defaults||{}); setCalcResult(null); persistParams(tsCode, activeMethod, m.defaults||{}) }}}>重置默认参数</button>
            </div>
          </div>
        </div>
        <div className="card-content space-y-4">
          {/* 当前价格 */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">当前价格</span>
            <span className="text-lg font-semibold">¥{Number(valuation.current_price ?? 0).toFixed(2)}</span>
          </div>

          {/* 方法 Tabs */}
          <div className="flex flex-wrap gap-2">
            {methods.map((m)=> <MethodTab key={m.key} m={m} />)}
          </div>

          {/* 参数表单 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {activeMethod==='PE' && (
              <>
                {renderParamField('eps','EPS')}
                {renderParamField('target_pe','目标PE',0.1)}
                {renderParamField('low_pe','低位PE',0.1)}
                {renderParamField('high_pe','高位PE',0.1)}
              </>
            )}
            {activeMethod==='PB' && (
              <>
                {renderParamField('bps','BPS')}
                {renderParamField('target_pb','目标PB',0.1)}
                {renderParamField('low_pb','低位PB',0.1)}
                {renderParamField('high_pb','高位PB',0.1)}
              </>
            )}
            {activeMethod==='PEG' && (
              <>
                {renderParamField('eps','EPS')}
                {renderParamField('growth','增长率',0.01)}
                {renderParamField('k','K系数',0.1)}
              </>
            )}
            {activeMethod==='EVEBITDA' && (
              <>
                {renderParamField('ebitda','EBITDA(¥)',0.01)}
                {renderParamField('target_multiple','目标倍数',0.1)}
                {renderParamField('low_multiple','低位倍数',0.1)}
                {renderParamField('high_multiple','高位倍数',0.1)}
                {renderParamField('net_debt','净负债(¥)',0.01)}
                {renderParamField('shares_outstanding','流通股数',1)}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={runCalc} disabled={calcLoading}>
              {calcLoading?'计算中...':'重新计算'}
            </button>
            {calcResult && (<span className="text-sm text-gray-600">估值：{calcResult.value?`¥${calcResult.value.toFixed(2)}`:'--'} ｜ 区间：{calcResult.range?`¥${calcResult.range.low.toFixed(2)} ~ ¥${calcResult.range.high.toFixed(2)}`:'--'}</span>)}
          </div>

          {/* 原有静态信息：PE/PB现状 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600">PE比率</div>
              <div className="text-xl font-bold text-primary-600">
                {Number(valuation.valuation.pe_ratio ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600">PB比率</div>
              <div className="text-xl font-bold text-primary-600">
                {Number(valuation.valuation.pb_ratio ?? 0).toFixed(2)}
              </div>
            </div>
          </div>

          {/* 财务数据 */}
          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900">财务数据</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">EPS</span>
                <span className="font-medium">{Number(valuation.financials.eps ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">BPS</span>
                <span className="font-medium">{Number(valuation.financials.bps ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">ROE</span>
                <span className="font-medium">{Number(valuation.financials.roe ?? 0).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">营收</span>
                <span className="font-medium">{(Number(valuation.financials.revenue ?? 0) / 100000000).toFixed(1)}亿</span>
              </div>
            </div>
          </div>

          {/* 分析结果 */}
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-900">分析结果</h4>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">PE分析:</span>
                <span className="text-sm">{valuation.analysis.pe_analysis}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">PB分析:</span>
                <span className="text-sm">{valuation.analysis.pb_analysis}</span>
              </div>
            </div>
            <div className={`p-3 rounded-lg ${getAssessmentColor(valuation.analysis.overall_assessment)}`}>
              <div className="flex items-center space-x-2">
                {getAssessmentIcon(valuation.analysis.overall_assessment)}
                <span className="font-medium">综合评估</span>
              </div>
              <p className="text-sm mt-1">{valuation.analysis.overall_assessment}</p>
            </div>
          </div>

          {/* 更新时间 */}
          <div className="text-xs text-gray-500 text-center">
            更新时间: {new Date(valuation.created_at).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}
