// packages/web/src/server.ts
// Upgrades: #10 Web Auth, #14 WebSocket

import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createLogger, eventBus, metricsCollector, toolCache } from '@quasar/core'
import type { AgentLoop } from '@quasar/agent'
import { SqliteMemory } from '@quasar/memory'
import { getLatestBrowserState } from '@quasar/tools'
import { randomUUID } from 'crypto'

const log = createLogger('web:server')
const __dirname = dirname(fileURLToPath(import.meta.url))

export interface WebServerOptions {
  agentLoop: AgentLoop
  memory: SqliteMemory
  port?: number
  host?: string
  apiKey?: string // Web auth (#10)
}

export function createWebServer(
  agentLoop: AgentLoop,
  memory: SqliteMemory,
  port = 18789,
  host = '127.0.0.1',
  apiKey?: string,
): void {
  const app = express()
  const server = createServer(app)

  app.use(express.json())

  // Auth middleware (#10)
  if (apiKey) {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health') return next() // health check is public
      const token = req.headers.authorization?.replace('Bearer ', '') || req.query.key
      if (token !== apiKey) {
        res.status(401).json({ error: 'Unauthorized. Provide API key via Authorization header or ?key= query param.' })
        return
      }
      next()
    })
    log.info('Web API authentication enabled')
  }

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

  // API: Stream chat (SSE) — used by Web UI (#1)
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

  // Helper to update key-value pairs in .env file
  function updateEnvFile(updates: Record<string, string>) {
    try {
      const envPath = resolve(process.cwd(), '.env')
      let content = ''
      if (existsSync(envPath)) {
        content = readFileSync(envPath, 'utf-8')
      }
      
      let lines = content.split(/\r?\n/)
      const keysToUpdate = { ...updates }
      
      lines = lines.map(line => {
        const match = line.match(/^([A-Z0-9_]+)=/)
        if (match) {
          const key = match[1]
          if (key in keysToUpdate) {
            const val = keysToUpdate[key]
            delete keysToUpdate[key]
            return `${key}=${val}`
          }
        }
        return line
      })
      
      for (const [key, val] of Object.entries(keysToUpdate)) {
        lines.push(`${key}=${val}`)
      }
      
      writeFileSync(envPath, lines.join('\n'), 'utf-8')
      log.info('.env file updated successfully')
    } catch (e) {
      log.error('Failed to update .env file:', e)
    }
  }

  // Helper to mask sensitive keys
  const maskKey = (key?: string): string => {
    if (!key) return ''
    if (key.length <= 10) return '********'
    return `${key.slice(0, 6)}...${key.slice(-4)}`
  }

  // API: Get current config (model & providers)
  app.get('/api/config', (_req, res) => {
    const config = agentLoop.getConfig()
    const providers = config.providers || {}
    
    const providersResponse = Object.fromEntries(
      Object.entries(providers).map(([name, prov]) => [
        name,
        {
          apiKey: maskKey(prov?.apiKey),
          baseUrl: prov?.baseUrl || ''
        }
      ])
    )
    
    res.json({
      model: agentLoop.getModel(),
      providers: providersResponse
    })
  })

  // API: Save config (model & providers)
  app.post('/api/config', (req, res) => {
    const { model, providers } = req.body as {
      model?: string
      providers?: Record<string, { apiKey?: string; baseUrl?: string }>
    }

    const envUpdates: Record<string, string> = {}

    if (model) {
      agentLoop.setModel(model)
      envUpdates['DEFAULT_MODEL'] = model
    }

    if (providers) {
      agentLoop.updateProviders(providers)
      
      const keyMap: Record<string, string> = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        google: 'GOOGLE_API_KEY',
        openrouter: 'OPENROUTER_API_KEY'
      }

      const urlMap: Record<string, string> = {
        ollama: 'OLLAMA_BASE_URL'
      }

      for (const [name, prov] of Object.entries(providers)) {
        if (prov.apiKey !== undefined) {
          const keyName = keyMap[name]
          const keyVal = prov.apiKey.trim()
          const isMasked = keyVal.includes('...') || keyVal === '********'
          if (keyName && !isMasked) {
            envUpdates[keyName] = keyVal
          }
        }
        if (prov.baseUrl !== undefined) {
          const urlName = urlMap[name]
          if (urlName) {
            envUpdates[urlName] = prov.baseUrl.trim()
          }
        }
      }
    }

    if (Object.keys(envUpdates).length > 0) {
      updateEnvFile(envUpdates)
    }

    res.json({ success: true, model: agentLoop.getModel() })
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

  // API: Token usage stats (#5)
  app.get('/api/stats', (_req, res) => {
    const usage = memory.getTotalTokenUsage(0) // web user = 0
    res.json({ tokenUsage: usage })
  })

  // API: Admin Metrics (#30)
  app.get('/api/admin/metrics', (_req, res) => {
    const stats = metricsCollector.getMetrics()
    const cacheStats = toolCache.getStats()
    res.json({
      ...stats,
      cache: cacheStats
    })
  })

  // API: Get latest browser state
  app.get('/api/browser/state', (_req, res) => {
    res.json(getLatestBrowserState() || { url: '', title: '', screenshot: '', elements: [] })
  })

  // --- WebSocket (#14) ---
  const wss = new WebSocketServer({ server, path: '/ws' })

  // Broadcast events to all connected WS clients for Admin Dashboard (#30)
  const broadcastEvent = (type: string, payload: any) => {
    const msg = JSON.stringify({ type, ...payload })
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    })
  }

  const broadcastMetrics = () => {
    const stats = metricsCollector.getMetrics()
    const cacheStats = toolCache.getStats()
    broadcastEvent('metrics:update', {
      ...stats,
      cache: cacheStats
    })
  }

  eventBus.on('tool:call', (e) => {
    broadcastEvent('tool:call', e)
    broadcastMetrics()
  })
  eventBus.on('agent:start', (e) => {
    broadcastEvent('agent:start', e)
    broadcastMetrics()
  })
  eventBus.on('agent:error', (e) => {
    broadcastEvent('agent:error', e)
    broadcastMetrics()
  })
  eventBus.on('token:usage', (e) => {
    broadcastEvent('token:usage', e)
    broadcastMetrics()
  })
  eventBus.on('browser:update', (e) => {
    broadcastEvent('browser:update', e)
  })

  wss.on('connection', (ws) => {
    let wsSessionId: string | null = null
    log.info('WebSocket client connected')

    // Send initial metrics and browser state
    try {
      const stats = metricsCollector.getMetrics()
      const cacheStats = toolCache.getStats()
      ws.send(JSON.stringify({
        type: 'metrics:update',
        ...stats,
        cache: cacheStats
      }))

      const browserState = getLatestBrowserState()
      if (browserState) {
        ws.send(JSON.stringify({
          type: 'browser:update',
          ...browserState
        }))
      }
    } catch (e) {
      log.error('Failed to send initial metrics or browser state to WS connection:', e)
    }

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; message?: string; sessionId?: string; model?: string; images?: string[] }

        if (msg.type === 'chat') {
          if (!msg.message) {
            ws.send(JSON.stringify({ type: 'error', error: 'message required' }))
            return
          }

          if (!wsSessionId) {
            const session = memory.createSession(0, 0, agentLoop.getModel())
            wsSessionId = session.id
            ws.send(JSON.stringify({ type: 'session', sessionId: wsSessionId }))
          }

          ws.send(JSON.stringify({ type: 'start' }))

          try {
            const response = await agentLoop.process(wsSessionId, msg.message, {
              stream: true,
              images: msg.images, // Vision support (#19)
              onChunk: (chunk) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'chunk', chunk }))
                }
              },
            })
            if (response.startsWith('⚠️ Error:')) {
              ws.send(JSON.stringify({ type: 'error', error: response }))
            } else {
              ws.send(JSON.stringify({ type: 'done', sessionId: wsSessionId }))
            }
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', error: e instanceof Error ? e.message : 'Error' }))
          }
        } else if (msg.type === 'new_session') {
          wsSessionId = null
          ws.send(JSON.stringify({ type: 'session_cleared' }))
        } else if (msg.type === 'set_model') {
          if (msg.model) {
            agentLoop.setModel(msg.model, wsSessionId || undefined)
            ws.send(JSON.stringify({ type: 'model_changed', model: msg.model }))
          }
        } else if (msg.type === 'set_session') {
          wsSessionId = msg.sessionId || null
          ws.send(JSON.stringify({ type: 'session', sessionId: wsSessionId }))
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }))
      }
    })

    ws.on('close', () => log.info('WebSocket client disconnected'))
  })

  // Redirect /admin to homepage (since they are merged)
  app.get('/admin', (_req, res) => {
    res.redirect('/')
  })

  // SPA fallback (Express 5 syntax)
  app.get('/{*path}', (_req, res) => {
    res.sendFile(resolve(__dirname, 'public', 'index.html'))
  })

  server.listen(port, host, () => {
    log.info(`WebChat UI: http://${host}:${port}`)
    log.info(`WebSocket: ws://${host}:${port}/ws`)
  })
}
