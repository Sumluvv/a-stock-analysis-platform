import { z } from 'zod';
import bcrypt from 'bcrypt';
import fastifyJwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function authRoutes(app) {
    app.post('/signup', async (req, reply) => {
        const schema = z.object({
            email: z.string().email(),
            password: z.string().min(6),
            name: z.string().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Invalid payload' });
        }
        const { email, password, name } = parsed.data;
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return reply.code(409).send({ error: 'Email already registered' });
        }
        const hash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({ data: { email, password: hash, name: name || null } });
        return { id: user.id, email: user.email, name: user.name };
    });
    app.post('/login', async (req, reply) => {
        const schema = z.object({
            email: z.string().email(),
            password: z.string().min(6),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Invalid payload' });
        }
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        const token = app.jwt.sign({ sub: user.id, email: user.email });
        return { token };
    });
}
//# sourceMappingURL=routes.js.map