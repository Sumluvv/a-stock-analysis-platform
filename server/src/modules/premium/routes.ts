export async function premiumRoutes(app: any) {
  app.get('/api/premium/pricing', async () => ({
    plans: [
      { id: 'free', name: '免费版', daily_calls: 5, price: 0 },
      { id: 'pro', name: '专业版', daily_calls: 100, price: 29 },
      { id: 'enterprise', name: '企业版', daily_calls: 1000, price: 199 },
    ]
  }))

  app.get('/api/premium/subscription', async () => ({
    plan: 'free', remaining_calls_today: 5
  }))

  app.get('/api/premium/usage', async () => ({
    today: { ai_calls: 0, cost: 0 },
    month: { ai_calls: 0, cost: 0 }
  }))

  app.post('/api/premium/subscribe', async (req, reply) => {
    return reply.code(200).send({ ok: true })
  })
}


