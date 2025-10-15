// 外部API管理页面
// frontend/src/pages/ExternalApiPage.tsx

import React, { useState, useEffect } from 'react';
import { ExternalApiManager } from '../components/ExternalApiManager';
import { Layout } from '../components/Layout';

export const ExternalApiPage: React.FC = () => {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">外部API管理</h1>
          <p className="text-gray-600">
            使用您自己的AI服务API Key进行股票分析，无需充值平台会员
          </p>
        </div>
        
        <ExternalApiManager />
      </div>
    </Layout>
  );
};



