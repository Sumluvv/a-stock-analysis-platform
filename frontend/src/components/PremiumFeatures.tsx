// 付费功能组件
// frontend/src/components/PremiumFeatures.tsx

import React, { useState, useEffect } from 'react';
import { Crown, Star, Zap, Shield, Check, X, AlertTriangle } from 'lucide-react';

interface PricingTier {
  tier: string;
  name: string;
  price: number;
  features: Array<{
    feature: string;
    name: string;
    description: string;
  }>;
  limits: {
    daily_ai_calls: number;
    daily_api_calls: number;
    data_retention_days: number;
    max_portfolio_size: number;
  };
}

interface Subscription {
  tier: string;
  status: string;
  expires_at: string;
  features: string[];
  limits: any;
}

interface PremiumFeaturesProps {
  className?: string;
}

export const PremiumFeatures: React.FC<PremiumFeaturesProps> = ({ 
  className = '' 
}) => {
  const [pricingInfo, setPricingInfo] = useState<{ tiers: Record<string, PricingTier> } | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('premium');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // 并行获取定价信息和订阅信息
        const [pricingResponse, subscriptionResponse] = await Promise.all([
          fetch('/api/premium/pricing'),
          fetch('/api/premium/subscription')
        ]);
        
        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          setPricingInfo(pricingData);
        }
        
        if (subscriptionResponse.ok) {
          const subscriptionData = await subscriptionResponse.json();
          setSubscription(subscriptionData);
        }
        
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSubscribe = async (tier: string) => {
    try {
      const response = await fetch('/api/premium/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier,
          duration_months: 1
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`订阅成功！订阅ID: ${result.subscription.subscription_id}`);
        // 刷新订阅信息
        window.location.reload();
      } else {
        const error = await response.json();
        alert(`订阅失败: ${error.message}`);
      }
    } catch (err) {
      alert(`订阅失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('确定要取消订阅吗？')) return;
    
    try {
      const response = await fetch('/api/premium/cancel-subscription', {
        method: 'POST'
      });

      if (response.ok) {
        alert('订阅已取消');
        window.location.reload();
      } else {
        const error = await response.json();
        alert(`取消失败: ${error.message}`);
      }
    } catch (err) {
      alert(`取消失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'free':
        return <Star className="h-6 w-6 text-gray-600" />;
      case 'premium':
        return <Crown className="h-6 w-6 text-yellow-600" />;
      case 'enterprise':
        return <Zap className="h-6 w-6 text-purple-600" />;
      default:
        return <Star className="h-6 w-6 text-gray-600" />;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'free':
        return 'border-gray-200 bg-gray-50';
      case 'premium':
        return 'border-yellow-300 bg-yellow-50';
      case 'enterprise':
        return 'border-purple-300 bg-purple-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  if (loading) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="text-center text-red-600">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>加载失败</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!pricingInfo) {
    return (
      <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
        <div className="text-center text-gray-500">
          <Shield className="h-8 w-8 mx-auto mb-2" />
          <p>暂无定价信息</p>
        </div>
      </div>
    );
  }

  const tiers = Object.values(pricingInfo.tiers);

  return (
    <div className={`bg-white rounded-lg shadow-sm p-6 ${className}`}>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">选择您的计划</h2>
        <p className="text-gray-600">解锁更多功能，提升投资分析能力</p>
      </div>

      {/* 当前订阅状态 */}
      {subscription && subscription.tier !== 'free' && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {getTierIcon(subscription.tier)}
              <span className="font-medium text-green-800">
                当前订阅：{pricingInfo.tiers[subscription.tier]?.name}
              </span>
            </div>
            <button
              onClick={handleCancelSubscription}
              className="text-red-600 hover:text-red-700 text-sm font-medium"
            >
              取消订阅
            </button>
          </div>
          <p className="text-sm text-green-700 mt-1">
            到期时间：{new Date(subscription.expires_at).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* 定价卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map((tier) => (
          <div
            key={tier.tier}
            className={`relative border-2 rounded-lg p-6 transition-all hover:shadow-lg ${
              tier.tier === selectedTier ? 'ring-2 ring-blue-500' : ''
            } ${getTierColor(tier.tier)}`}
          >
            {/* 推荐标签 */}
            {tier.tier === 'premium' && (
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-medium">
                  推荐
                </span>
              </div>
            )}

            <div className="text-center mb-6">
              <div className="flex items-center justify-center mb-2">
                {getTierIcon(tier.tier)}
              </div>
              <h3 className="text-xl font-semibold text-gray-900">{tier.name}</h3>
              <div className="mt-2">
                {tier.price > 0 ? (
                  <div>
                    <span className="text-3xl font-bold text-gray-900">¥{tier.price}</span>
                    <span className="text-gray-600">/月</span>
                  </div>
                ) : (
                  <span className="text-3xl font-bold text-gray-900">免费</span>
                )}
              </div>
            </div>

            {/* 功能列表 */}
            <div className="space-y-3 mb-6">
              {tier.features.map((feature) => (
                <div key={feature.feature} className="flex items-start space-x-2">
                  <Check className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-gray-900">{feature.name}</div>
                    <div className="text-sm text-gray-600">{feature.description}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* 限制信息 */}
            <div className="mb-6 p-3 bg-white rounded border">
              <h4 className="font-medium text-gray-900 mb-2">使用限制</h4>
              <div className="space-y-1 text-sm text-gray-600">
                <div>AI分析：{tier.limits.daily_ai_calls}次/天</div>
                <div>API调用：{tier.limits.daily_api_calls}次/天</div>
                <div>数据保留：{tier.limits.data_retention_days}天</div>
                <div>投资组合：{tier.limits.max_portfolio_size}只股票</div>
              </div>
            </div>

            {/* 订阅按钮 */}
            <div className="text-center">
              {tier.tier === 'free' ? (
                <div className="text-gray-500 text-sm">当前版本</div>
              ) : subscription?.tier === tier.tier ? (
                <div className="text-green-600 font-medium">已订阅</div>
              ) : (
                <button
                  onClick={() => handleSubscribe(tier.tier)}
                  className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                    tier.tier === 'premium'
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-600 text-white hover:bg-gray-700'
                  }`}
                >
                  立即订阅
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 功能对比表 */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">功能对比</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium text-gray-900">功能</th>
                {tiers.map((tier) => (
                  <th key={tier.tier} className="text-center py-2 font-medium text-gray-900">
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiers[0]?.features.map((feature) => (
                <tr key={feature.feature} className="border-b">
                  <td className="py-2 text-gray-900">{feature.name}</td>
                  {tiers.map((tier) => (
                    <td key={tier.tier} className="text-center py-2">
                      {tier.features.some(f => f.feature === feature.feature) ? (
                        <Check className="h-5 w-5 text-green-600 mx-auto" />
                      ) : (
                        <X className="h-5 w-5 text-gray-400 mx-auto" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 常见问题 */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">常见问题</h3>
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-gray-900">如何取消订阅？</h4>
            <p className="text-sm text-gray-600">
              您可以随时在账户设置中取消订阅，取消后将在当前计费周期结束时生效。
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">支持哪些支付方式？</h4>
            <p className="text-sm text-gray-600">
              目前支持微信支付、支付宝等主流支付方式。
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">可以随时升级或降级吗？</h4>
            <p className="text-sm text-gray-600">
              可以随时升级到更高版本，降级将在下个计费周期生效。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};



