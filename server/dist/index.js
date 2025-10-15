import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { feedRoutes } from './modules/feeds/routes';
import { valuationRoutes } from './modules/valuation/routes';
import { externalApiRoutes } from './modules/external/routes';
import { aiRoutes } from './modules/ai/routes';
import { premiumRoutes } from './modules/premium/routes';
import fastifyJwt from '@fastify/jwt';
import { spawn } from 'child_process';
import path from 'path';
import { Pool } from 'pg';
dotenv.config();
// 数据库连接池
const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
const buildServer = () => {
    const app = Fastify({ logger: true });
    app.register(cors, { origin: true });
    app.register(fastifyJwt, { secret: process.env.JWT_SECRET || 'change_me_in_prod' });
    app.get('/health', async () => ({ status: 'ok' }));
    app.register(feedRoutes, { prefix: '/api/feeds' });
    app.register(valuationRoutes, { prefix: '/api/valuation' });
    app.register(aiRoutes);
    app.register(premiumRoutes);
    // 注册外部API路由
    app.register(async (app) => {
        await externalApiRoutes(app, pgPool);
    });
    return app;
};
const start = async () => {
    const app = buildServer();
    const port = Number(process.env.PORT || 3001);
    await app.listen({ port, host: '0.0.0.0' });
    // 定时任务：每日北京时间11:30触发热门榜刷新
    try {
        const schedule = () => {
            const now = new Date();
            const next = new Date();
            // 11:30 CST = 03:30 UTC
            next.setUTCHours(3, 30, 0, 0);
            if (now > next)
                next.setUTCDate(next.getUTCDate() + 1);
            const delay = Math.max(1000, next.getTime() - now.getTime());
            setTimeout(async function tick() {
                try {
                    await fetch(`http://127.0.0.1:${port}/api/feeds/hot/update`, { method: 'POST' });
                }
                catch { }
                try {
                    const etlDir = path.resolve(process.cwd(), '..', 'etl');
                    const python = path.join(etlDir, '.venv', 'bin', 'python');
                    const ps = spawn(python, [path.join(etlDir, 'build_hot_stocks.py')], { cwd: etlDir, stdio: 'ignore' });
                    ps.on('close', () => { });
                }
                catch { }
                setTimeout(tick, 24 * 60 * 60 * 1000);
            }, delay);
        };
        schedule();
    }
    catch { }
};
start().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map