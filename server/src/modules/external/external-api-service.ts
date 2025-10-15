// 外部API Key验证服务
// server/src/modules/external/external-api-service.ts

import { Pool } from 'pg';
import { z } from 'zod';

export enum ExternalProvider {
  GEMINI_PRO = 'gemini_pro',
  OPENAI_PLUS = 'openai_plus',
  CLAUDE_PRO = 'claude_pro',
  CUSTOM_API = 'custom_api'
}

export interface ExternalApiKey {
  id: string;
  user_id: string;
  provider: ExternalProvider;
  api_key: string; // 加密存储
  display_name: string;
  is_active: boolean;
  usage_limit: number; // 每日使用限制
  used_count: number; // 今日已使用次数
  created_at: string;
  updated_at: string;
}

export interface ExternalApiUsage {
  id: string;
  user_id: string;
  api_key_id: string;
  provider: ExternalProvider;
  endpoint: string;
  tokens_used: number;
  cost_usd: number;
  response_time_ms: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

export class ExternalApiService {
  private pgPool: Pool;

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
  }

  /**
   * 添加外部API Key
   */
  async addApiKey(
    userId: string,
    provider: ExternalProvider,
    apiKey: string,
    displayName: string,
    usageLimit: number = 100
  ): Promise<{ success: boolean; apiKeyId?: string; message: string }> {
    try {
      // 验证API Key有效性
      const isValid = await this.validateApiKey(provider, apiKey);
      if (!isValid) {
        return {
          success: false,
          message: 'API Key验证失败，请检查Key是否正确'
        };
      }

      // 加密存储API Key
      const encryptedKey = await this.encryptApiKey(apiKey);

      const query = `
        INSERT INTO app.external_api_keys (user_id, provider, api_key, display_name, usage_limit, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
        RETURNING id
      `;

      const result = await this.pgPool.query(query, [
        userId,
        provider,
        encryptedKey,
        displayName,
        usageLimit
      ]);

      return {
        success: true,
        apiKeyId: result.rows[0].id,
        message: 'API Key添加成功'
      };
    } catch (error: any) {
      console.error('Error adding API key:', error);
      return {
        success: false,
        message: '添加API Key失败: ' + error.message
      };
    }
  }

  /**
   * 验证API Key有效性
   */
  private async validateApiKey(provider: ExternalProvider, apiKey: string): Promise<boolean> {
    try {
      switch (provider) {
        case ExternalProvider.GEMINI_PRO:
          return await this.validateGeminiKey(apiKey);
        case ExternalProvider.OPENAI_PLUS:
          return await this.validateOpenAIKey(apiKey);
        case ExternalProvider.CLAUDE_PRO:
          return await this.validateClaudeKey(apiKey);
        default:
          return false;
      }
    } catch (error) {
      console.error('Error validating API key:', error);
      return false;
    }
  }

  /**
   * 验证Gemini API Key
   */
  private async validateGeminiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: {
          'X-Goog-Api-Key': apiKey
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * 验证OpenAI API Key
   */
  private async validateOpenAIKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * 验证Claude API Key
   */
  private async validateClaudeKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        })
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取用户的外部API Keys
   */
  async getUserApiKeys(userId: string): Promise<ExternalApiKey[]> {
    try {
      const query = `
        SELECT id, user_id, provider, display_name, usage_limit, used_count, is_active, created_at, updated_at
        FROM app.external_api_keys
        WHERE user_id = $1 AND is_active = true
        ORDER BY created_at DESC
      `;

      const result = await this.pgPool.query(query, [userId]);
      return result.rows.map(row => ({
        ...row,
        api_key: '***' // 不返回真实API Key
      }));
    } catch (error) {
      console.error('Error getting user API keys:', error);
      return [];
    }
  }

  /**
   * 检查API Key使用限制
   */
  async checkApiKeyLimit(apiKeyId: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: string;
  }> {
    try {
      const query = `
        SELECT usage_limit, used_count
        FROM app.external_api_keys
        WHERE id = $1 AND is_active = true
      `;

      const result = await this.pgPool.query(query, [apiKeyId]);
      
      if (result.rows.length === 0) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: new Date().toISOString()
        };
      }

      const { usage_limit, used_count } = result.rows[0];
      const remaining = Math.max(0, usage_limit - used_count);
      const allowed = remaining > 0;

      // 计算重置时间（明天0点）
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      return {
        allowed,
        remaining,
        resetTime: tomorrow.toISOString()
      };
    } catch (error) {
      console.error('Error checking API key limit:', error);
      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date().toISOString()
      };
    }
  }

  /**
   * 记录API使用
   */
  async recordApiUsage(
    userId: string,
    apiKeyId: string,
    provider: ExternalProvider,
    endpoint: string,
    tokensUsed: number,
    costUsd: number,
    responseTimeMs: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      // 记录使用日志
      const usageQuery = `
        INSERT INTO app.external_api_usage (user_id, api_key_id, provider, endpoint, tokens_used, cost_usd, response_time_ms, success, error_message, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `;

      await this.pgPool.query(usageQuery, [
        userId,
        apiKeyId,
        provider,
        endpoint,
        tokensUsed,
        costUsd,
        responseTimeMs,
        success,
        errorMessage
      ]);

      // 更新使用计数
      if (success) {
        const updateQuery = `
          UPDATE app.external_api_keys
          SET used_count = used_count + 1, updated_at = NOW()
          WHERE id = $1
        `;
        await this.pgPool.query(updateQuery, [apiKeyId]);
      }
    } catch (error) {
      console.error('Error recording API usage:', error);
    }
  }

  /**
   * 获取API Key的真实值（解密）
   */
  async getDecryptedApiKey(apiKeyId: string): Promise<string | null> {
    try {
      const query = `
        SELECT api_key FROM app.external_api_keys
        WHERE id = $1 AND is_active = true
      `;

      const result = await this.pgPool.query(query, [apiKeyId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return await this.decryptApiKey(result.rows[0].api_key);
    } catch (error) {
      console.error('Error getting decrypted API key:', error);
      return null;
    }
  }

  /**
   * 删除API Key
   */
  async deleteApiKey(userId: string, apiKeyId: string): Promise<boolean> {
    try {
      const query = `
        UPDATE app.external_api_keys
        SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
      `;

      const result = await this.pgPool.query(query, [apiKeyId, userId]);
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting API key:', error);
      return false;
    }
  }

  /**
   * 获取使用统计
   */
  async getUsageStats(userId: string, days: number = 30): Promise<{
    total_requests: number;
    total_tokens: number;
    total_cost: number;
    by_provider: Record<string, any>;
    daily_breakdown: Array<{
      date: string;
      requests: number;
      tokens: number;
      cost: number;
    }>;
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = `
        SELECT 
          provider,
          DATE(created_at) as date,
          COUNT(*) as requests,
          SUM(tokens_used) as tokens,
          SUM(cost_usd) as cost
        FROM app.external_api_usage
        WHERE user_id = $1 AND created_at >= $2 AND success = true
        GROUP BY provider, DATE(created_at)
        ORDER BY date DESC
      `;

      const result = await this.pgPool.query(query, [userId, startDate]);

      const dailyBreakdown = new Map<string, any>();
      const byProvider: Record<string, any> = {};

      result.rows.forEach(row => {
        const date = row.date;
        const provider = row.provider;

        // 每日统计
        if (!dailyBreakdown.has(date)) {
          dailyBreakdown.set(date, { date, requests: 0, tokens: 0, cost: 0 });
        }
        const dayStats = dailyBreakdown.get(date);
        dayStats.requests += parseInt(row.requests);
        dayStats.tokens += parseInt(row.tokens);
        dayStats.cost += parseFloat(row.cost);

        // 按提供商统计
        if (!byProvider[provider]) {
          byProvider[provider] = { requests: 0, tokens: 0, cost: 0 };
        }
        byProvider[provider].requests += parseInt(row.requests);
        byProvider[provider].tokens += parseInt(row.tokens);
        byProvider[provider].cost += parseFloat(row.cost);
      });

      const totalRequests = Object.values(byProvider).reduce((sum: number, p: any) => sum + p.requests, 0);
      const totalTokens = Object.values(byProvider).reduce((sum: number, p: any) => sum + p.tokens, 0);
      const totalCost = Object.values(byProvider).reduce((sum: number, p: any) => sum + p.cost, 0);

      return {
        total_requests: totalRequests,
        total_tokens: totalTokens,
        total_cost: totalCost,
        by_provider: byProvider,
        daily_breakdown: Array.from(dailyBreakdown.values()).sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )
      };
    } catch (error) {
      console.error('Error getting usage stats:', error);
      return {
        total_requests: 0,
        total_tokens: 0,
        total_cost: 0,
        by_provider: {},
        daily_breakdown: []
      };
    }
  }

  /**
   * 加密API Key
   */
  private async encryptApiKey(apiKey: string): Promise<string> {
    // 简单的Base64编码，实际生产环境应使用更强的加密
    return Buffer.from(apiKey).toString('base64');
  }

  /**
   * 解密API Key
   */
  private async decryptApiKey(encryptedKey: string): Promise<string> {
    // 简单的Base64解码，实际生产环境应使用对应的解密
    return Buffer.from(encryptedKey, 'base64').toString('utf-8');
  }
}
