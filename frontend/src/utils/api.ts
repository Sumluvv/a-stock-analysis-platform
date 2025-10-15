import axios from 'axios'

// 创建axios实例
// 说明：开发环境通过 Vite 代理使用 '/api'；
// 预览/生产环境默认直连后端 http://127.0.0.1:3002/api，亦可通过 VITE_API_BASE 覆盖
const isDev = import.meta.env && import.meta.env.DEV
const baseURL = (import.meta.env && import.meta.env.VITE_API_BASE) || (isDev ? '/api' : 'http://127.0.0.1:3002/api')

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证token
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    // 统一错误处理
    if (error.response) {
      const { status, data } = error.response
      
      switch (status) {
        case 401:
          // 未授权，清除token并跳转到登录页
          localStorage.removeItem('token')
          window.location.href = '/login'
          break
        case 403:
          console.error('权限不足:', data.message)
          break
        case 404:
          console.error('资源不存在:', data.message)
          break
        case 500:
          console.error('服务器错误:', data.message)
          break
        default:
          console.error('请求失败:', data.message || '未知错误')
      }
    } else if (error.request) {
      console.error('网络错误:', '请检查网络连接')
    } else {
      console.error('请求配置错误:', error.message)
    }
    
    return Promise.reject(error)
  }
)

// API函数
export const apiFunctions = {
  // 获取股票概览
  getStockOverview: (tsCode: string) => api.get(`/feeds/overview/${tsCode}`),
  
  // 获取K线数据
  getKlineData: (tsCode: string) => api.get(`/feeds/kline/${tsCode}`),
  
  // 获取估值数据
  getValuation: (tsCode: string) => api.get(`/valuation/${tsCode}`),
  
  // 获取DCF估值数据
  getDCFValuation: (tsCode: string) => api.get(`/valuation/dcf/${tsCode}`),
  
  // 计算DCF估值
  calculateDCF: (tsCode: string, params: any) => api.post(`/valuation/dcf/${tsCode}/calculate`, params),
  
  // 获取AI评分
  getAIScore: (tsCode: string) => api.get(`/valuation/ai-score/${tsCode}`),
  
  // 计算AI评分
  calculateAIScore: (tsCode: string) => api.post(`/valuation/ai-score/${tsCode}/calculate`),
  
  // 用户认证
  login: (credentials: any) => api.post('/auth/login', credentials),
  register: (userData: any) => api.post('/auth/register', userData),
}

export { api }
