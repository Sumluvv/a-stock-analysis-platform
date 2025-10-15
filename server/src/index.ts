import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { authRoutes } from './modules/auth/routes';
import { feedRoutes } from './modules/feeds/routes';
import fastifyJwt from '@fastify/jwt';

dotenv.config();

const buildServer = () => {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });
  app.register(fastifyJwt, { secret: process.env.JWT_SECRET || 'change_me_in_prod' });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(feedRoutes, { prefix: '/api/feeds' });

  return app;
};

const start = async () => {
  const app = buildServer();
  const port = Number(process.env.PORT || 3001);
  await app.listen({ port, host: '0.0.0.0' });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
