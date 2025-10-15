import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { StockDetailPage } from './pages/StockDetailPage'
import { HomePage } from './pages/HomePage'
import { HotStocksPage } from './pages/HotStocksPage'
import { RankingsPage } from './pages/RankingsPage'
import { ExternalApiPage } from './pages/ExternalApiPage'
import { ApiUsagePage } from './pages/ApiUsagePage'
import { AgentsPage } from './pages/AgentsPage'
import { Layout } from './components/Layout'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/stock/:tsCode" element={<StockDetailPage />} />
          <Route path="/hot-stocks" element={<HotStocksPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/external-api" element={<ExternalApiPage />} />
          <Route path="/api-usage" element={<ApiUsagePage />} />
          <Route path="/agents" element={<AgentsPage />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App



