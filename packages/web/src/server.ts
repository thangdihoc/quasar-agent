// packages/web/src/server.ts

import express from 'express'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '@quasar/core'
import type { AgentLoop } from '@quasar/agent'
import { SqliteMemory } from '@quasar/memory'
import { randomUUID } from 'crypto'

const log = createLogger('web:server')
const __dirname = dirname(fileURLToPath(import.meta.url))

export function createWebServer(
  agentLoop: AgentLoop,
  memory: SqliteMemory,
  port = 18789,
  host = '127.0.0.1',
): void {
  const app = express()
  app.use(express.json())
  app.use(express.static(resolve(__dirname, 'public')))

  // API: Create session
  app.post('/api/session', (_req, res) => {
    const session = memory.createSession(0, 0, agentLoop.getModel())
    res.json({ sessionId: session.id })
  })

  // API: Send message
  app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body as { sessionId?: string; message?: string }
    if (!message) { res.status(400).json({ error: 'message required' }); return }

    let sid = sessionId
    if (!sid) {
      const session = memory.createSession(0, 0, agentLoop.getModel())
      sid = session.id
    }

    try {
      const response = await agentLoop.process(sid, message)
      res.json({ sessionId: sid, response })
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' })
    }
  })

  // API: Stream chat (SSE)
  app.post('/api/chat/stream', async (req, res) => {
    const { sessionId, message } = req.body as { sessionId?: string; message?: string }
    if (!message) { res.status(400).json({ error: 'message required' }); return }

    let sid = sessionId
    if (!sid) {
      const session = memory.createSession(0, 0, agentLoop.getModel())
      sid = session.id
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      await agentLoop.process(sid, message, {
        stream: true,
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
        },
      })
      res.write(`data: ${JSON.stringify({ done: true, sessionId: sid })}\n\n`)
    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : 'Error' })}\n\n`)
    }
    res.end()
  })

  // API: Get model
  app.get('/api/model', (_req, res) => {
    res.json({ model: agentLoop.getModel() })
  })

  // API: Set model
  app.post('/api/model', (req, res) => {
    const { model } = req.body as { model?: string }
    if (!model) { res.status(400).json({ error: 'model required' }); return }
    agentLoop.setModel(model)
    res.json({ model })
  })

  // API: Health
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      model: agentLoop.getModel(),
      tools: agentLoop.getToolDefs().map(t => t.name),
      uptime: Math.floor(process.uptime()),
    })
  })

  // SPA fallback (Express 5 syntax)
  app.get('/{*path}', (_req, res) => {
    res.sendFile(resolve(__dirname, 'public', 'index.html'))
  })

  app.listen(port, host, () => {
    log.info(`WebChat UI: http://${host}:${port}`)
  })
}
