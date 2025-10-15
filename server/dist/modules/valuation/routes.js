import { Pool } from 'pg';
// 创建数据库连接池
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'infostream',
    user: process.env.PGUSER || 'infostream',
    password: process.env.PGPASSWORD || 'infostream',
});
export async function valuationRoutes(fastify) {
    // 获取股票估值信息
    fastify.get('/:ts_code', async (request, reply) => {
        const { ts_code } = request.params;
        try {
            const client = await pool.connect();
            try {
                // 获取最新估值数据
                const valuationQuery = `
          SELECT 
            v.ts_code,
            v.as_of_date,
            v.method,
            v.pe_implied_price,
            v.pb_implied_price,
            v.input_json,
            v.result_json,
            v.created_at
          FROM valuations v
          WHERE v.ts_code = $1 
          ORDER BY v.as_of_date DESC, v.created_at DESC
          LIMIT 1
        `;
                const valuationResult = await client.query(valuationQuery, [ts_code]);
                if (valuationResult.rows.length === 0) {
                    return reply.status(404).send({
                        error: 'Valuation data not found',
                        message: `No valuation data found for ${ts_code}`
                    });
                }
                const valuation = valuationResult.rows[0];
                // 获取最新股价
                const priceQuery = `
          SELECT close, trade_date
          FROM prices_ohlcv 
          WHERE ts_code = $1 
          ORDER BY trade_date DESC 
          LIMIT 1
        `;
                const priceResult = await client.query(priceQuery, [ts_code]);
                const currentPrice = priceResult.rows[0]?.close || null;
                // 获取最新财务数据
                const financialsQuery = `
          SELECT 
            MAX(CASE WHEN metric_name = 'eps' THEN metric_value END) as eps,
            MAX(CASE WHEN metric_name = 'bps' THEN metric_value END) as bps,
            MAX(CASE WHEN metric_name = 'roe' THEN metric_value END) as roe,
            MAX(CASE WHEN metric_name = 'revenue' THEN metric_value END) as revenue,
            MAX(CASE WHEN metric_name = 'net_profit' THEN metric_value END) as net_profit,
            MAX(report_period) as latest_period
          FROM fin_metrics 
          WHERE ts_code = $1 
          AND metric_name IN ('eps', 'bps', 'roe', 'revenue', 'net_profit')
        `;
                const financialsResult = await client.query(financialsQuery, [ts_code]);
                const financials = financialsResult.rows[0];
                // 构建响应数据
                const response = {
                    ts_code: valuation.ts_code,
                    as_of_date: valuation.as_of_date,
                    method: valuation.method,
                    current_price: currentPrice,
                    financials: {
                        eps: financials?.eps || null,
                        bps: financials?.bps || null,
                        roe: financials?.roe || null,
                        revenue: financials?.revenue || null,
                        net_profit: financials?.net_profit || null,
                        latest_period: financials?.latest_period || null
                    },
                    valuation: {
                        pe_ratio: valuation.result_json?.pe_ratio || null,
                        pb_ratio: valuation.result_json?.pb_ratio || null,
                        pe_implied_price: valuation.pe_implied_price,
                        pb_implied_price: valuation.pb_implied_price
                    },
                    analysis: {
                        pe_analysis: getPEAnalysis(valuation.result_json?.pe_ratio),
                        pb_analysis: getPBAnalysis(valuation.result_json?.pb_ratio),
                        overall_assessment: getOverallAssessment(valuation.result_json?.pe_ratio, valuation.result_json?.pb_ratio)
                    },
                    created_at: valuation.created_at
                };
                return reply.send(response);
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            fastify.log.error('Valuation API error:', error);
            return reply.status(500).send({
                error: 'Internal server error',
                message: 'Failed to fetch valuation data'
            });
        }
    });
    // 获取估值历史
    fastify.get('/:ts_code/history', async (request, reply) => {
        const { ts_code } = request.params;
        try {
            const client = await pool.connect();
            try {
                const query = `
          SELECT 
            as_of_date,
            method,
            pe_implied_price,
            pb_implied_price,
            result_json,
            created_at
          FROM valuations
          WHERE ts_code = $1
          ORDER BY as_of_date DESC, created_at DESC
          LIMIT 30
        `;
                const result = await client.query(query, [ts_code]);
                const history = result.rows.map(row => ({
                    as_of_date: row.as_of_date,
                    method: row.method,
                    pe_ratio: row.result_json?.pe_ratio || null,
                    pb_ratio: row.result_json?.pb_ratio || null,
                    pe_implied_price: row.pe_implied_price,
                    pb_implied_price: row.pb_implied_price,
                    created_at: row.created_at
                }));
                return reply.send({
                    ts_code,
                    history,
                    count: history.length
                });
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            fastify.log.error('Valuation history API error:', error);
            return reply.status(500).send({
                error: 'Internal server error',
                message: 'Failed to fetch valuation history'
            });
        }
    });
    // 获取DCF估值
    fastify.get('/dcf/:ts_code', async (request, reply) => {
        const { ts_code } = request.params;
        try {
            const client = await pool.connect();
            try {
                // 获取DCF估值数据
                const dcfQuery = `
          SELECT 
            v.ts_code,
            v.as_of_date,
            v.method,
            v.dcf_base,
            v.dcf_range_low,
            v.dcf_range_high,
            v.input_json,
            v.result_json,
            v.created_at
          FROM valuations v
          WHERE v.ts_code = $1 AND v.method = 'DCF'
          ORDER BY v.as_of_date DESC, v.created_at DESC
          LIMIT 1
        `;
                const dcfResult = await client.query(dcfQuery, [ts_code]);
                if (dcfResult.rows.length === 0) {
                    return reply.status(404).send({
                        error: 'DCF valuation not found',
                        message: `No DCF valuation found for ${ts_code}`
                    });
                }
                const dcf = dcfResult.rows[0];
                const resultData = dcf.result_json || {};
                const inputData = dcf.input_json || {};
                // 获取最新股价
                const priceQuery = `
          SELECT close, trade_date
          FROM prices_ohlcv 
          WHERE ts_code = $1 
          ORDER BY trade_date DESC 
          LIMIT 1
        `;
                const priceResult = await client.query(priceQuery, [ts_code]);
                const currentPrice = priceResult.rows[0]?.close || null;
                // 构建DCF响应数据
                const response = {
                    ts_code: dcf.ts_code,
                    as_of_date: dcf.as_of_date,
                    method: dcf.method,
                    current_price: currentPrice,
                    dcf_value: dcf.dcf_base,
                    dcf_range: {
                        low: dcf.dcf_range_low,
                        high: dcf.dcf_range_high
                    },
                    upside_downside: resultData.upside_downside || null,
                    valuation_ratios: {
                        pe_ratio: resultData.pe_ratio || null,
                        pb_ratio: resultData.pb_ratio || null
                    },
                    parameters: {
                        discount_rate: inputData.discount_rate || null,
                        terminal_growth_rate: inputData.terminal_growth_rate || null,
                        projection_years: inputData.projection_years || null
                    },
                    growth_rates: inputData.growth_rates || {},
                    projections: resultData.projections || [],
                    sensitivity_analysis: resultData.sensitivity_analysis || {},
                    enterprise_value: resultData.enterprise_value || null,
                    terminal_value: resultData.terminal_value || null,
                    error: resultData.error || null,
                    analysis: {
                        dcf_analysis: resultData.error ? resultData.error : getDCFAnalysis(resultData.upside_downside),
                        risk_assessment: resultData.error ? "无法评估" : getDCFRiskAssessment(dcf.dcf_range_low, dcf.dcf_range_high, currentPrice),
                        recommendation: resultData.error ? "数据不足，无法给出建议" : getDCFRecommendation(resultData.upside_downside, dcf.dcf_range_low, dcf.dcf_range_high)
                    },
                    created_at: dcf.created_at
                };
                return reply.send(response);
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            fastify.log.error('DCF API error:', error);
            return reply.status(500).send({
                error: 'Internal server error',
                message: 'Failed to fetch DCF valuation data'
            });
        }
    });
    // 计算DCF估值
    fastify.post('/dcf/:ts_code/calculate', async (request, reply) => {
        const { ts_code } = request.params;
        const body = request.body || {};
        const { discount_rate = 0.10, terminal_growth_rate = 0.03, projection_years = 5 } = body;
        try {
            // 调用Python DCF计算脚本
            const { spawn } = require('child_process');
            const path = require('path');
            const etlDir = path.resolve(process.cwd(), '..', 'etl');
            const venvPython = path.join(etlDir, '.venv', 'bin', 'python');
            return new Promise((resolve, reject) => {
                const process = spawn(venvPython, [path.join(etlDir, 'dcf_valuation.py'), ts_code], {
                    cwd: etlDir
                });
                process.on('error', (error) => {
                    fastify.log.error('DCF calculation process error:', error);
                    reply.code(500).send({
                        error: 'Internal server error',
                        message: 'Failed to initiate DCF calculation'
                    });
                    resolve(null);
                });
                process.on('close', (code) => {
                    if (code === 0) {
                        reply.send({
                            message: 'DCF calculation completed',
                            ts_code,
                            parameters: {
                                discount_rate,
                                terminal_growth_rate,
                                projection_years
                            }
                        });
                        resolve(null);
                    }
                    else {
                        fastify.log.error(`DCF calculation failed with code ${code}`);
                        reply.code(500).send({
                            error: 'Internal server error',
                            message: 'DCF calculation failed'
                        });
                        resolve(null);
                    }
                });
            });
        }
        catch (error) {
            fastify.log.error('DCF calculation API error:', error);
            return reply.status(500).send({
                error: 'Internal server error',
                message: 'Failed to initiate DCF calculation'
            });
        }
    });
    // 获取AI评分
    fastify.get('/ai-score/:ts_code', async (request, reply) => {
        const { ts_code } = request.params;
        try {
            const client = await pool.connect();
            try {
                // 获取AI评分数据
                const aiQuery = `
          SELECT 
            ts_code,
            as_of_date,
            score,
            action,
            top_factors_json,
            model_version,
            created_at
          FROM ai_scores
          WHERE ts_code = $1
          ORDER BY as_of_date DESC, created_at DESC
          LIMIT 1
        `;
                const aiResult = await client.query(aiQuery, [ts_code]);
                if (aiResult.rows.length === 0) {
                    return reply.status(404).send({
                        error: 'AI score not found',
                        message: `No AI score found for ${ts_code}`
                    });
                }
                const ai = aiResult.rows[0];
                const topFactors = ai.top_factors_json || [];
                // 获取最新股价
                const priceQuery = `
          SELECT close, trade_date
          FROM prices_ohlcv 
          WHERE ts_code = $1 
          ORDER BY trade_date DESC 
          LIMIT 1
        `;
                const priceResult = await client.query(priceQuery, [ts_code]);
                const currentPrice = priceResult.rows[0]?.close || null;
                // 构建AI评分响应数据
                const response = {
                    ts_code: ai.ts_code,
                    as_of_date: ai.as_of_date,
                    score: ai.score,
                    action: ai.action,
                    model_version: ai.model_version,
                    current_price: currentPrice,
                    top_factors: topFactors,
                    analysis: {
                        score_analysis: getScoreAnalysis(ai.score),
                        action_analysis: getActionAnalysis(ai.action),
                        confidence: getConfidenceLevel(ai.score, topFactors.length)
                    },
                    created_at: ai.created_at
                };
                return reply.send(response);
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            fastify.log.error('AI Score API error:', error);
            return reply.status(500).send({
                error: 'Internal server error',
                message: 'Failed to fetch AI score data'
            });
        }
    });
    // 计算AI评分
    fastify.post('/ai-score/:ts_code/calculate', async (request, reply) => {
        const { ts_code } = request.params;
        try {
            // 这里可以调用Python AI评分脚本
            // 为了简化，我们返回一个模拟的响应
            return reply.send({
                message: 'AI score calculation initiated',
                ts_code,
                note: 'Please run the AI scoring script to get actual results'
            });
        }
        catch (error) {
            fastify.log.error('AI Score calculation API error:', error);
            return reply.status(500).send({
                error: 'Internal server error',
                message: 'Failed to initiate AI score calculation'
            });
        }
    });
}
// PE分析函数
function getPEAnalysis(peRatio) {
    if (!peRatio)
        return '数据不足';
    if (peRatio < 10)
        return 'PE较低，可能被低估';
    if (peRatio < 15)
        return 'PE适中，估值合理';
    if (peRatio < 25)
        return 'PE偏高，需关注成长性';
    return 'PE过高，存在估值风险';
}
// PB分析函数
function getPBAnalysis(pbRatio) {
    if (!pbRatio)
        return '数据不足';
    if (pbRatio < 1)
        return 'PB小于1，可能被严重低估';
    if (pbRatio < 2)
        return 'PB较低，估值合理';
    if (pbRatio < 4)
        return 'PB适中，需关注资产质量';
    return 'PB过高，存在估值风险';
}
// 综合评估函数
function getOverallAssessment(peRatio, pbRatio) {
    if (!peRatio || !pbRatio)
        return '数据不足，无法评估';
    const peScore = peRatio < 15 ? 3 : peRatio < 25 ? 2 : 1;
    const pbScore = pbRatio < 2 ? 3 : pbRatio < 4 ? 2 : 1;
    const totalScore = peScore + pbScore;
    if (totalScore >= 5)
        return '估值合理，值得关注';
    if (totalScore >= 3)
        return '估值偏高，谨慎投资';
    return '估值过高，风险较大';
}
// DCF分析函数
function getDCFAnalysis(upsideDownside) {
    if (!upsideDownside)
        return '数据不足';
    if (upsideDownside > 20)
        return 'DCF估值显著高于当前价格，存在较大上涨空间';
    if (upsideDownside > 0)
        return 'DCF估值高于当前价格，存在上涨空间';
    if (upsideDownside > -20)
        return 'DCF估值接近当前价格，估值相对合理';
    return 'DCF估值低于当前价格，可能存在高估风险';
}
// DCF风险评估函数
function getDCFRiskAssessment(rangeLow, rangeHigh, currentPrice) {
    if (!rangeLow || !rangeHigh || !currentPrice)
        return '数据不足';
    const rangeMid = (rangeLow + rangeHigh) / 2;
    const rangeWidth = rangeHigh - rangeLow;
    const rangePercent = (rangeWidth / rangeMid) * 100;
    if (rangePercent < 20)
        return '估值范围较窄，风险较低';
    if (rangePercent < 40)
        return '估值范围适中，风险中等';
    return '估值范围较宽，风险较高';
}
// DCF投资建议函数
function getDCFRecommendation(upsideDownside, rangeLow, rangeHigh) {
    if (!upsideDownside || !rangeLow || !rangeHigh)
        return '数据不足，无法给出建议';
    if (upsideDownside > 30)
        return '强烈买入：DCF估值显著高于当前价格';
    if (upsideDownside > 10)
        return '买入：DCF估值高于当前价格';
    if (upsideDownside > -10)
        return '持有：DCF估值接近当前价格';
    if (upsideDownside > -30)
        return '卖出：DCF估值低于当前价格';
    return '强烈卖出：DCF估值显著低于当前价格';
}
// AI评分分析函数
function getScoreAnalysis(score) {
    if (!score)
        return '数据不足';
    if (score >= 80)
        return 'AI评分优秀，投资价值很高';
    if (score >= 70)
        return 'AI评分良好，值得关注';
    if (score >= 60)
        return 'AI评分中等，谨慎投资';
    if (score >= 40)
        return 'AI评分偏低，风险较高';
    return 'AI评分很低，不建议投资';
}
// AI投资建议分析函数
function getActionAnalysis(action) {
    if (!action)
        return '数据不足';
    switch (action) {
        case '强烈买入':
            return 'AI强烈推荐买入，预期收益较高';
        case '买入':
            return 'AI建议买入，存在投资机会';
        case '持有':
            return 'AI建议持有，维持现状';
        case '观望':
            return 'AI建议观望，等待更好时机';
        case '卖出':
            return 'AI建议卖出，降低风险';
        default:
            return 'AI建议不明确，需要更多信息';
    }
}
// 置信度分析函数
function getConfidenceLevel(score, factorCount) {
    if (!score)
        return '低';
    let confidence = '中';
    // 基于评分范围
    if (score >= 80 || score <= 20) {
        confidence = '高';
    }
    else if (score >= 60 && score <= 40) {
        confidence = '低';
    }
    // 基于因素数量
    if (factorCount >= 5) {
        confidence = confidence === '高' ? '高' : '中';
    }
    else if (factorCount < 3) {
        confidence = '低';
    }
    return confidence;
}
//# sourceMappingURL=routes.js.map