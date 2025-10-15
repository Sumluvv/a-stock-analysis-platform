// 外部API Key管理路由
// server/src/modules/api/external/routes.ts

import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { ExternalApiService, ExternalProvider } from './external-api-service';

export async function externalApiRoutes(app: FastifyInstance, pgPool: Pool) {
  const externalApiService = new ExternalApiService(pgPool);

  // 添加外部API Key
  app.post('/api/external/api-keys', async (request, reply) => {
    const schema = z.object({
      provider: z.nativeEnum(ExternalProvider),
      api_key: z.string().min(10),
      display_name: z.string().min(1).max(100),
      usage_limit: z.coerce.number().min(1).max(10000).optional().default(100)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request body' });
    
    const { provider, api_key, display_name, usage_limit } = parsed.data;
    const userId = (request as any).user?.id || 'anonymous';
    
    try {
      const result = await externalApiService.addApiKey(
        userId,
        provider,
        api_key,
        display_name,
        usage_limit
      );
      
      if (result.success) {
        return {
          success: true,
          api_key_id: result.apiKeyId,
          message: result.message
        };
      } else {
        return reply.code(400).send({
          error: 'Failed to add API key',
          message: result.message
        });
      }
    } catch (error: any) {
      return reply.code(500).send({ 
        error: 'Failed to add API key', 
        message: error.message 
      });
    }
  });

  // 获取用户的外部API Keys
  app.get('/api/external/api-keys', async (request, reply) => {
    const userId = (request as any).user?.id || 'anonymous';
    
    try {
      const apiKeys = await externalApiService.getUserApiKeys(userId);
      return { api_keys: apiKeys };
    } catch (error: any) {
      return reply.code(500).send({ 
        error: 'Failed to get API keys', 
        message: error.message 
      });
    }
  });

  // 删除外部API Key
  app.delete('/api/external/api-keys/:apiKeyId', async (request, reply) => {
    const schema = z.object({ 
      apiKeyId: z.string().uuid()
    });
    const parsed = schema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid API key ID' });
    
    const { apiKeyId } = parsed.data;
    const userId = (request as any).user?.id || 'anonymous';
    
    try {
      const success = await externalApiService.deleteApiKey(userId, apiKeyId);
      
      if (success) {
        return {
          success: true,
          message: 'API key deleted successfully'
        };
      } else {
        return reply.code(404).send({
          error: 'API key not found',
          message: 'The specified API key does not exist or you do not have permission to delete it'
        });
      }
    } catch (error: any) {
      return reply.code(500).send({ 
        error: 'Failed to delete API key', 
        message: error.message 
      });
    }
  });

  // 检查API Key使用限制
  app.get('/api/external/api-keys/:apiKeyId/limit', async (request, reply) => {
    const schema = z.object({ 
      apiKeyId: z.string().uuid()
    });
    const parsed = schema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid API key ID' });
    
    const { apiKeyId } = parsed.data;
    
    try {
      const limit = await externalApiService.checkApiKeyLimit(apiKeyId);
      
      if (!limit.allowed) {
        return reply.code(429).send({
          error: 'API limit exceeded',
          remaining: limit.remaining,
          resetTime: limit.resetTime,
          message: 'Daily usage limit exceeded for this API key'
        });
      }
      
      return limit;
    } catch (error: any) {
      return reply.code(500).send({ 
        error: 'Failed to check API limit', 
        message: error.message 
      });
    }
  });

  // 获取使用统计
  app.get('/api/external/usage-stats', async (request, reply) => {
    const schema = z.object({
      days: z.coerce.number().min(1).max(365).optional().default(30)
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query parameters' });
    
    const { days } = parsed.data;
    const userId = (request as any).user?.id || 'anonymous';
    
    try {
      const stats = await externalApiService.getUsageStats(userId, days);
      return stats;
    } catch (error: any) {
      return reply.code(500).send({ 
        error: 'Failed to get usage stats', 
        message: error.message 
      });
    }
  });

  // 使用外部API Key进行AI分析
  app.post('/api/external/ai-analysis', async (request, reply) => {
    const schema = z.object({
      api_key_id: z.string().uuid(),
      ts_code: z.string(),
      analysis_type: z.enum(['stock_analysis', 'news_analysis', 'strategy_suggestion']).optional().default('stock_analysis'),
      stock_data: z.record(z.string(), z.any()).optional(),
      news_text: z.string().optional(),
      portfolio: z.array(z.record(z.string(), z.any())).optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request body' });
    
    const { api_key_id, ts_code, analysis_type, stock_data, news_text, portfolio } = parsed.data;
    const userId = (request as any).user?.id || 'anonymous';
    
    try {
      // 检查API Key限制
      const limit = await externalApiService.checkApiKeyLimit(api_key_id);
      if (!limit.allowed) {
        return reply.code(429).send({
          error: 'API limit exceeded',
          remaining: limit.remaining,
          resetTime: limit.resetTime
        });
      }

      // 获取API Key
      const apiKey = await externalApiService.getDecryptedApiKey(api_key_id);
      if (!apiKey) {
        return reply.code(404).send({
          error: 'API key not found',
          message: 'The specified API key does not exist or is inactive'
        });
      }

      // 调用外部AI服务
      const startTime = Date.now();
      let result: any;
      let success = false;
      let errorMessage: string | undefined;

      try {
        switch (analysis_type) {
          case 'stock_analysis':
            result = await callExternalStockAnalysis(apiKey, ts_code, stock_data);
            break;
          case 'news_analysis':
            result = await callExternalNewsAnalysis(apiKey, news_text || '');
            break;
          case 'strategy_suggestion':
            result = await callExternalStrategySuggestion(apiKey, portfolio || []);
            break;
          default:
            throw new Error('Unsupported analysis type');
        }
        success = true;
      } catch (error: any) {
        errorMessage = error.message;
        result = {
          summary: '分析失败',
          action: 'hold',
          confidence: 0.0,
          reasoning: errorMessage
        };
      }

      const responseTime = Date.now() - startTime;

      // 记录使用情况
      await externalApiService.recordApiUsage(
        userId,
        api_key_id,
        ExternalProvider.GEMINI_PRO, // 这里需要根据API Key类型确定
        `/api/external/ai-analysis/${analysis_type}`,
        result.tokens_used || 0,
        result.cost_usd || 0,
        responseTime,
        success,
        errorMessage
      );

      return {
        ...result,
        api_key_id,
        analysis_type,
        response_time_ms: responseTime,
        success
      };

    } catch (error: any) {
      return reply.code(500).send({ 
        error: 'Failed to perform AI analysis', 
        message: error.message 
      });
    }
  });

  // 获取支持的AI提供商列表
  app.get('/api/external/providers', async (request, reply) => {
    const providers = [
      {
        id: ExternalProvider.GEMINI_PRO,
        name: 'Google Gemini Pro',
        description: 'Google的先进AI模型，支持多模态分析',
        features: ['股票分析', '新闻解读', '策略建议'],
        pricing: '按使用量计费',
        website: 'https://ai.google.dev/'
      },
      {
        id: ExternalProvider.OPENAI_PLUS,
        name: 'OpenAI GPT-4',
        description: 'OpenAI的GPT-4模型，强大的推理能力',
        features: ['深度分析', '复杂推理', '多语言支持'],
        pricing: '按Token计费',
        website: 'https://openai.com/'
      },
      {
        id: ExternalProvider.CLAUDE_PRO,
        name: 'Anthropic Claude',
        description: 'Anthropic的Claude模型，注重安全性和准确性',
        features: ['安全分析', '准确预测', '风险控制'],
        pricing: '按使用量计费',
        website: 'https://www.anthropic.com/'
      }
    ];

    return { providers };
  });
}

// 辅助函数：调用外部股票分析
async function callExternalStockAnalysis(apiKey: string, tsCode: string, stockData: any) {
  // 这里实现调用Gemini API的逻辑
  const prompt = `
    请分析股票 ${tsCode} 的投资价值：
    
    股票数据：
    - 当前价格: ${stockData?.close || 'N/A'}
    - 涨跌幅: ${stockData?.pct_chg || 'N/A'}%
    - 成交量: ${stockData?.vol || 'N/A'}
    - 成交额: ${stockData?.amount || 'N/A'}
    - 换手率: ${stockData?.turnover_rate || 'N/A'}%
    - 量比: ${stockData?.volume_ratio || 'N/A'}
    
    请从技术面、基本面、市场情绪等角度进行分析，并给出投资建议。
    返回格式：{"summary": "分析摘要", "action": "buy/sell/hold/watch", "confidence": 0.8, "reasoning": "详细分析"}
  `;

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!content) {
    throw new Error('No content returned from Gemini API');
  }

  try {
    const result = JSON.parse(content);
    return {
      ...result,
      tokens_used: data.usageMetadata?.totalTokenCount || 0,
      cost_usd: (data.usageMetadata?.totalTokenCount || 0) * 0.0001 // 估算成本
    };
  } catch (error) {
    // 如果JSON解析失败，返回默认格式
    return {
      summary: content.substring(0, 200),
      action: 'hold',
      confidence: 0.5,
      reasoning: content,
      tokens_used: data.usageMetadata?.totalTokenCount || 0,
      cost_usd: (data.usageMetadata?.totalTokenCount || 0) * 0.0001
    };
  }
}

// 辅助函数：调用外部新闻分析
async function callExternalNewsAnalysis(apiKey: string, newsText: string) {
  const prompt = `
    请分析以下财经新闻的投资影响：
    
    ${newsText}
    
    请从市场情绪、行业影响、个股影响等角度分析，并给出投资建议。
    返回格式：{"summary": "分析摘要", "sentiment": "positive/negative/neutral", "impact": "high/medium/low", "action": "buy/sell/hold/watch", "confidence": 0.8}
  `;

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 800
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!content) {
    throw new Error('No content returned from Gemini API');
  }

  try {
    const result = JSON.parse(content);
    return {
      ...result,
      tokens_used: data.usageMetadata?.totalTokenCount || 0,
      cost_usd: (data.usageMetadata?.totalTokenCount || 0) * 0.0001
    };
  } catch (error) {
    return {
      summary: content.substring(0, 200),
      sentiment: 'neutral',
      impact: 'medium',
      action: 'hold',
      confidence: 0.5,
      reasoning: content,
      tokens_used: data.usageMetadata?.totalTokenCount || 0,
      cost_usd: (data.usageMetadata?.totalTokenCount || 0) * 0.0001
    };
  }
}

// 辅助函数：调用外部策略建议
async function callExternalStrategySuggestion(apiKey: string, portfolio: any[]) {
  const portfolioText = portfolio.map(stock => 
    `${stock.name || stock.ts_code}: ${stock.close || 'N/A'} (${stock.pct_chg || 'N/A'}%)`
  ).join('\n');

  const prompt = `
    请分析以下投资组合并提供调仓建议：
    
    投资组合：
    ${portfolioText}
    
    请从风险分散、行业配置、估值水平等角度分析，并给出具体的调仓建议。
    返回格式：{"summary": "分析摘要", "suggestions": ["建议1", "建议2"], "risk_level": "low/medium/high", "confidence": 0.8}
  `;

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!content) {
    throw new Error('No content returned from Gemini API');
  }

  try {
    const result = JSON.parse(content);
    return {
      ...result,
      tokens_used: data.usageMetadata?.totalTokenCount || 0,
      cost_usd: (data.usageMetadata?.totalTokenCount || 0) * 0.0001
    };
  } catch (error) {
    return {
      summary: content.substring(0, 200),
      suggestions: ['保持当前配置'],
      risk_level: 'medium',
      confidence: 0.5,
      reasoning: content,
      tokens_used: data.usageMetadata?.totalTokenCount || 0,
      cost_usd: (data.usageMetadata?.totalTokenCount || 0) * 0.0001
    };
  }
}
