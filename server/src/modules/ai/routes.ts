export async function aiRoutes(app: any) {
  app.get('/api/ai/health', async () => ({ status: 'ok' }))

  app.post('/api/ai/insight', async (req, reply) => {
    return reply.code(200).send({ task: 'insight', status: 'queued', result: null })
  })

  app.post('/api/ai/news', async (req, reply) => {
    return reply.code(200).send({ task: 'news', status: 'queued', result: null })
  })

  app.post('/api/ai/strategy', async (req, reply) => {
    return reply.code(200).send({ task: 'strategy', status: 'queued', result: null })
  })
}


