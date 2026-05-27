// packages/web/src/server.ts
// Upgrades: #10 Web Auth, #14 WebSocket

import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createLogger, eventBus, metricsCollector, toolCache, type McpServerConfig } from '@quasar/core'
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

  const oauthSessions = new Map<string, {
    serviceName: string;
    clientId: string;
    clientSecret: string;
  }>()

  app.use(express.json())

  // Auth middleware (#10)
  if (apiKey) {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path === '/oauth/callback') return next() // health check & oauth callback are public
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
    const { sessionId, message, disabledIntegrations } = req.body as { sessionId?: string; message?: string; disabledIntegrations?: string[] }
    if (!message) { res.status(400).json({ error: 'message required' }); return }

    let sid = sessionId
    if (!sid) {
      const session = memory.createSession(0, 0, agentLoop.getModel())
      sid = session.id
    }

    try {
      const response = await agentLoop.process(sid, message, { disabledIntegrations })
      res.json({ sessionId: sid, response })
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' })
    }
  })

  // API: Stream chat (SSE) — used by Web UI (#1)
  app.post('/api/chat/stream', async (req, res) => {
    const { sessionId, message, disabledIntegrations } = req.body as { sessionId?: string; message?: string; disabledIntegrations?: string[] }
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
        disabledIntegrations,
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

  // API: Get dynamic MCP servers status & tools
  app.get('/api/mcp', (_req, res) => {
    try {
      const configured = agentLoop.getMcpServersList()
      const connected = agentLoop.getMcpManager().getConnectedServers()

      const response = configured.map(server => {
        const conn = connected.find(c => c.name === server.name)
        return {
          ...server,
          connected: !!conn,
          tools: conn ? conn.tools : []
        }
      })

      res.json(response)
    } catch (e) {
      log.error('Failed to get MCP servers list:', e)
      res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' })
    }
  })

  // API: Connect/save dynamic MCP server
  app.post('/api/mcp', async (req, res) => {
    const config = req.body as McpServerConfig
    if (!config || !config.name || !config.command || !config.args) {
      res.status(400).json({ error: 'name, command, and args are required' })
      return
    }

    try {
      log.info(`API Request to connect MCP server: ${config.name}`)
      const tools = await agentLoop.connectMcpServer(config)
      res.json({ success: true, tools })
    } catch (e) {
      log.error(`API Failed to connect MCP server ${config.name}:`, e)
      res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' })
    }
  })

  // API: Disconnect dynamic MCP server
  app.delete('/api/mcp/:name', async (req, res) => {
    const { name } = req.params
    if (!name) {
      res.status(400).json({ error: 'server name is required' })
      return
    }

    try {
      log.info(`API Request to disconnect MCP server: ${name}`)
      await agentLoop.disconnectMcpServer(name)
      res.json({ success: true })
    } catch (e) {
      log.error(`API Failed to disconnect MCP server ${name}:`, e)
      res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' })
    }
  })

  // API: Get OAuth Auth URL
  app.get('/api/oauth/url', (req, res) => {
    const { serviceName, clientId, clientSecret } = req.query as { serviceName?: string; clientId?: string; clientSecret?: string }
    if (!serviceName || !clientId || !clientSecret) {
      res.status(400).json({ error: 'serviceName, clientId, and clientSecret are required' })
      return
    }

    const state = randomUUID()
    oauthSessions.set(state, { serviceName, clientId, clientSecret })

    let scopes = ''
    if (serviceName === 'gmail') {
      scopes = 'https://mail.google.com/'
    } else if (serviceName === 'gdrive') {
      scopes = 'https://www.googleapis.com/auth/drive'
    } else if (serviceName === 'gcal') {
      scopes = 'https://www.googleapis.com/auth/calendar'
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: `http://${host}:${port}/api/oauth/callback`,
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state: state
    }).toString()

    res.json({ url: authUrl })
  })

  // API: OAuth Callback
  app.get('/api/oauth/callback', async (req, res) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string }
    
    if (error) {
      res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h2 style="color: #ef4444;">Lỗi Xác thực Google Login</h2>
            <p>${error}</p>
            <button onclick="window.close()" style="padding: 10px 20px; font-size: 14px; cursor: pointer; border-radius: 6px; border: 1px solid #ccc;">Đóng cửa sổ</button>
          </body>
        </html>
      `)
      return
    }

    if (!code || !state) {
      res.status(400).send('Missing code or state')
      return
    }

    const session = oauthSessions.get(state)
    if (!session) {
      res.status(400).send('OAuth session not found or expired')
      return
    }

    oauthSessions.delete(state)

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code,
          client_id: session.clientId,
          client_secret: session.clientSecret,
          redirect_uri: `http://${host}:${port}/api/oauth/callback`,
          grant_type: 'authorization_code',
        })
      })

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text()
        throw new Error(`Failed to exchange code: ${errorText}`)
      }

      const tokens = await tokenRes.json() as { refresh_token?: string }
      if (!tokens.refresh_token) {
        throw new Error('Google did not return a refresh token. Make sure you revoke existing access in Google settings or add prompt=consent.')
      }

      let mcpConfig: McpServerConfig
      if (session.serviceName === 'gmail') {
        mcpConfig = {
          name: 'gmail',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-gmail'],
          env: {
            GMAIL_CLIENT_ID: session.clientId,
            GMAIL_CLIENT_SECRET: session.clientSecret,
            GMAIL_REFRESH_TOKEN: tokens.refresh_token
          }
        }
      } else if (session.serviceName === 'gdrive') {
        mcpConfig = {
          name: 'gdrive',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-gdrive'],
          env: {
            GDRIVE_CLIENT_ID: session.clientId,
            GDRIVE_CLIENT_SECRET: session.clientSecret,
            GDRIVE_REFRESH_TOKEN: tokens.refresh_token
          }
        }
      } else {
        mcpConfig = {
          name: 'gcal',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-google-calendar'],
          env: {
            GOOGLE_CLIENT_ID: session.clientId,
            GOOGLE_CLIENT_SECRET: session.clientSecret,
            GOOGLE_REFRESH_TOKEN: tokens.refresh_token
          }
        }
      }

      log.info(`Connecting dynamic MCP server from Google OAuth: ${session.serviceName}`)
      await agentLoop.connectMcpServer(mcpConfig)

      res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h2 style="color: #10b981;">Kết nối Google thành công! 🎉</h2>
            <p>Đã thiết lập liên kết thành công với ứng dụng Google của bạn.</p>
            <p>Cửa sổ này sẽ tự động đóng.</p>
            <script>
              setTimeout(() => {
                if (window.opener) {
                  window.opener.postMessage({ type: 'oauth-success', serviceName: '${session.serviceName}' }, '*');
                }
                window.close();
              }, 2000);
            </script>
          </body>
        </html>
      `)
    } catch (err: any) {
      log.error(`OAuth callback error: ${err.message}`)
      res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h2 style="color: #ef4444;">Lỗi Xác thực Google</h2>
            <p>${err.message}</p>
            <button onclick="window.close()" style="padding: 10px 20px; font-size: 14px; cursor: pointer; border-radius: 6px; border: 1px solid #ccc;">Đóng cửa sổ</button>
          </body>
        </html>
      `)
    }
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

  // --- WebSocket for Nova Mascot ---
  const novaWss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  
  const broadcastNovaState = (state: string, detail?: string) => {
    const msg = JSON.stringify({ state, detail })
    novaWss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    })
  }

  // Map agent events to Nova states
  eventBus.on('agent:start', () => broadcastNovaState('thinking', 'Processing request...'))
  eventBus.on('agent:response', () => broadcastNovaState('idle'))
  eventBus.on('agent:error', () => broadcastNovaState('idle'))
  eventBus.on('tool:call', (e) => broadcastNovaState('thinking', `Using tool: ${(e as any).name || 'unknown'}`))

  novaWss.on('connection', (ws) => {
    log.info('[Nova] Mascot connected')
    ws.send(JSON.stringify({ state: 'idle' }))
    ws.on('close', () => log.info('[Nova] Mascot disconnected'))
  })

  // --- WebSocket (#14) ---
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })

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
        const msg = JSON.parse(data.toString()) as {
          type: string;
          message?: string;
          sessionId?: string;
          model?: string;
          images?: string[];
          disabledIntegrations?: string[];
        }

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
              disabledIntegrations: msg.disabledIntegrations,
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

  // Manual routing of WebSocket upgrades to avoid port collisions and protocol compression issues
  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`)
      const pathname = url.pathname

      if (pathname === '/nova') {
        novaWss.handleUpgrade(request, socket, head, (ws) => {
          novaWss.emit('connection', ws, request)
        })
      } else if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request)
        })
      } else {
        socket.destroy()
      }
    } catch (e) {
      log.error('WebSocket upgrade error:', e)
      socket.destroy()
    }
  })

  server.listen(port, host, () => {
    log.info(`WebChat UI: http://${host}:${port}`)
    log.info(`WebSocket: ws://${host}:${port}/ws`)
    log.info(`Nova Mascot WS: ws://${host}:${port}/nova`)
  })
}
