// packages/cli/src/index.ts — Entry point

import 'dotenv/config'
import { createLogger, enableTraceLog, eventBus, loadConfigFile } from '@quasar/core'
import type { QuasarConfig } from '@quasar/core'
import { SqliteMemory, LanceDBMemory } from '@quasar/memory'
import { AllowlistManager } from '@quasar/security'
import { QuasarBot } from '@quasar/telegram'
import { AgentLoop } from '@quasar/agent'
import { registerAllTools, loadPlugins, registerPlugins } from '@quasar/tools'
import { createWebServer } from '@quasar/web'
import { McpClientManager } from '@quasar/mcp'
import { CronScheduler } from '@quasar/scheduler'
import { loadSkills, skillsToPrompt } from '@quasar/skills'
import { ImageService, TTSService } from '@quasar/media'
import { mkdir } from 'fs/promises'
import { resolve } from 'path'
import { spawn, execSync } from 'child_process'
import OpenAI from 'openai'

const log = createLogger('cli')

const BANNER = `
  ██████╗ ██╗   ██╗ █████╗ ███████╗ █████╗ ██████╗
 ██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔══██╗██╔══██╗
 ██║   ██║██║   ██║███████║███████║███████║██████╔╝
 ██║▄▄ ██║██║   ██║██╔══██║╚════██║██╔══██║██╔══██╗
 ╚██████╔╝╚██████╔╝██║  ██║███████║██║  ██║██║  ██║
  ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
   Personal AI Agent v0.3.0
`

// Default config — override with quasar.config.ts
function getConfig(): QuasarConfig {
  return {
    gateway: { port: 18789, host: '127.0.0.1' },
    agent: {
      model: process.env.DEFAULT_MODEL || 'gpt-4o',
      thinkingLevel: 'medium',
      maxTokens: 4096,
    },
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN || '',
      allowedUsers: process.env.ALLOWED_USERS
        ? process.env.ALLOWED_USERS.split(',').map(Number)
        : [],
    },
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY },
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
      google: { apiKey: process.env.GOOGLE_API_KEY },
      openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      ollama: {
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      },
    },
    tools: {
      allow: [
        'exec',
        'file_read',
        'file_write',
        'file_edit',
        'file_list',
        'web_fetch',
        'web_search',
        'web_browser',
        'pdf_read',
        'generate_image',
        'text_to_speech',
        'schedule_task',
        'cancel_task',
        'computer_use',
        'remember_info',
        'search_memories',
        'create_plan',
        'update_plan',
        'get_plan',
        'run_code',
        'define_workflow',
        'run_workflow',
        'list_workflows',
        'render_mermaid',
        'render_code_image',
        'knowledge_index_file',
        'knowledge_index_folder',
        'knowledge_search',
        'knowledge_stats',
        'delegate_task',
        'list_agents'
      ],
      deny: [],
      execRequiresApproval: true,
    },
    web: {
      apiKey: process.env.WEB_API_KEY || '',
    },
    memory: {
      sqlitePath: resolve('./data/memory.db'),
      lancedbPath: resolve('./data/vectors'),
    },
    computerUse: {
      enabled: process.env.COMPUTER_USE_ENABLED === 'true' || true,
      pythonPort: 18790,
      provider: undefined,
      model: undefined,
    },
    mcp: {
      servers: [],
    },
  }
}

async function start() {
  console.log(BANNER)
  let config = getConfig()

  // Load config file if exists (#11)
  try {
    config = await loadConfigFile(config)
  } catch (e) {
    log.warn('Config file loading failed, using defaults:', e)
  }

  // Validate
  if (!config.telegram.token) {
    log.error('TELEGRAM_BOT_TOKEN is required. Set it in .env')
    process.exit(1)
  }

  // Create data directory + enable trace logging
  await mkdir('./data', { recursive: true })
  await enableTraceLog('./data')

  // Event bus logging
  eventBus.on('agent:start', (e) => log.info(`[event] Agent started: ${e.type}`))
  eventBus.on('agent:error', (e) => log.error(`[event] Agent error: ${(e as any).error}`))
  eventBus.on('model:switch', (e) => log.info(`[event] Model: ${(e as any).from} → ${(e as any).to}`))
  eventBus.on('token:usage', (e) => {
    const ev = e as any
    log.info(`[event] Tokens: +${ev.totalTokens} (prompt: ${ev.promptTokens}, completion: ${ev.completionTokens}) [${ev.model}]`)
  })

  // Load skills
  const skills = await loadSkills('./skills')
  const skillsPrompt = skillsToPrompt(skills)
  if (skillsPrompt) {
    config.agent.systemPrompt = (config.agent.systemPrompt || '') + skillsPrompt
  }

  // Init SQLite memory & Allowlist
  const memory = new SqliteMemory(config.memory.sqlitePath)
  const allowlist = new AllowlistManager(config.telegram.allowedUsers)

  // Init LanceDB memory if OpenAI key is present
  let vectorMemory: LanceDBMemory | undefined
  const openAiApiKey = config.providers.openai?.apiKey
  if (openAiApiKey) {
    const openaiClient = new OpenAI({ apiKey: openAiApiKey })
    vectorMemory = new LanceDBMemory(config.memory.lancedbPath, async (text) => {
      const res = await openaiClient.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      })
      return res.data[0]!.embedding
    })
    try {
      await vectorMemory.init()
    } catch (e) {
      log.error('Failed to initialize LanceDB memory:', e)
      vectorMemory = undefined
    }
  } else {
    log.warn('OPENAI_API_KEY is not set. LanceDB memory (RAG) is disabled.')
  }

  // Init Agent loop (with vectorMemory)
  const agentLoop = new AgentLoop(config, memory, vectorMemory)

  // Start SyncManager for Context Sync
  let syncManager: any = null
  if (vectorMemory) {
    try {
      const { SyncManager } = await import('@quasar/tools')
      syncManager = new SyncManager(vectorMemory, resolve('./data/sync'))
      syncManager.start()
    } catch (e) {
      log.error('Failed to start SyncManager:', e)
    }
  }

  // Init services
  const imageService = openAiApiKey ? new ImageService(openAiApiKey) : undefined
  const ttsService = openAiApiKey ? new TTSService(openAiApiKey) : undefined
  const cronScheduler = new CronScheduler()

  // Init Telegram bot
  const bot = new QuasarBot(config, agentLoop, memory, allowlist)

  // Task trigger handler
  const handleTaskTrigger = async (id: string, prompt: string, description: string) => {
    log.info(`Task triggered: ${id} - ${description}`)
    const userId = config.telegram.allowedUsers[0]
    if (!userId) {
      log.warn('No allowed users configured to receive task notifications')
      return
    }

    try {
      await bot.sendMessage(
        userId,
        `🔔 *Scheduled Task Triggered:* _${description}_ (ID: \`${id}\`)\nRunning agent prompt: "${prompt}"...`
      )
      const result = await agentLoop.process(`task-${id}-${Date.now()}`, prompt)
      await bot.sendMessage(
        userId,
        `📊 *Task Result [${id}]:*\n\n${result}`
      )
    } catch (err) {
      log.error(`Task ${id} execution failed:`, err)
      await bot.sendMessage(
        userId,
        `❌ *Task Failed [${id}]:*\nError: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // Register tools with approval callback
  registerAllTools({
    config,
    agent: agentLoop,
    memory,
    allowlist,
    onApprovalNeeded: config.tools.execRequiresApproval
      ? async (id, command) => {
          const userId = config.telegram.allowedUsers[0]
          if (userId) await bot.sendApprovalRequest(userId, id, command)
        }
      : undefined,
    imageService,
    ttsService,
    cronScheduler,
    vectorMemory,
    onTaskTrigger: handleTaskTrigger,
  })

  // Connect to static MCP servers defined in configuration file
  if (config.mcp?.servers) {
    for (const serverConfig of config.mcp.servers) {
      try {
        await agentLoop.connectMcpServer(serverConfig, false)
      } catch (err) {
        log.error(`Failed to connect static MCP server ${serverConfig.name}:`, err)
      }
    }
  }

  // Spawn Python Computer Use service if enabled
  let pythonProcess: any = null
  if (config.computerUse?.enabled) {
    const pythonPort = config.computerUse.pythonPort || 18790
    log.info(`Starting Python Computer Use service on port ${pythonPort}...`)
    
    // Detect python vs python3 dynamically
    let pyCmd = 'python'
    try {
      execSync('python --version', { stdio: 'ignore' })
    } catch {
      try {
        execSync('python3 --version', { stdio: 'ignore' })
        pyCmd = 'python3'
      } catch {
        log.warn('Neither "python" nor "python3" was found on PATH. Defaulting to "python".')
      }
    }

    pythonProcess = spawn(pyCmd, ['modules/computer-use/main.py'], {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(pythonPort) }
    })

    pythonProcess.on('error', (err: any) => {
      log.error('Failed to start Python computer-use service:', err)
    })
  }

  // Load plugins (#12)
  try {
    const plugins = await loadPlugins('./plugins')
    registerPlugins(agentLoop, plugins)
    if (plugins.length > 0) {
      log.info(`Registered ${plugins.length} plugins`)
    }
  } catch (e) {
    log.warn('Plugin loading failed:', e)
  }

  // Start Express WebChat UI (with auth #10)
  try {
    const webApiKey = (config as any).web?.apiKey || undefined
    createWebServer(agentLoop, memory, config.gateway.port, config.gateway.host, webApiKey)
  } catch (err) {
    log.error('Failed to start WebChat server:', err)
  }

  // Spawn Tauri Desktop Mascot & Chat UI
  let tauriProcess: any = null
  if (process.env.START_DESKTOP !== 'false') {
    log.info('Starting Tauri Desktop application (Mascot & Chat UI)...')
    const isWindows = process.platform === 'win32'
    const cmd = isWindows ? 'cmd.exe' : 'pnpm'
    const args = isWindows 
      ? ['/c', 'pnpm', '--filter', '@quasar/desktop', 'dev']
      : ['--filter', '@quasar/desktop', 'dev']

    tauriProcess = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env }
    })

    tauriProcess.on('error', (err: any) => {
      log.error('Failed to start Tauri desktop application:', err)
    })
  }

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...')
    
    // Stop SyncManager
    if (syncManager) {
      try {
        syncManager.stop()
      } catch { /* ignore */ }
    }

    // Stop Telegram bot
    try {
      await bot.stop()
    } catch { /* ignore */ }

    // Stop all cron tasks
    try {
      cronScheduler.stopAll()
    } catch { /* ignore */ }

    // Disconnect MCP servers
    try {
      await agentLoop.disconnectAllMcp()
    } catch { /* ignore */ }

    // Terminate Python Computer Use service
    if (pythonProcess) {
      log.info('Stopping Python computer-use service...')
      try {
        pythonProcess.kill()
      } catch { /* ignore */ }
    }

    // Terminate Tauri desktop app
    if (tauriProcess) {
      log.info('Stopping Tauri desktop application...')
      try {
        tauriProcess.kill()
      } catch { /* ignore */ }
    }

    // Close SQLite memory
    try {
      memory.close()
    } catch { /* ignore */ }

    log.info('Shutdown complete.')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Start Telegram bot
  log.info(`Model: ${config.agent.model}`)
  log.info(`Tools: ${agentLoop.getToolDefs().map(t => t.name).join(', ')}`)
  await bot.start()
}

// --- Interactive Setup ---
async function setup() {
  console.log(BANNER)
  console.log('🔧 Quasar Setup — Cấu hình API keys\n')

  const { createInterface } = await import('readline')
  const { writeFile, readFile } = await import('fs/promises')
  const { existsSync } = await import('fs')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res))

  // Load existing .env if any
  let existing: Record<string, string> = {}
  if (existsSync('.env')) {
    const content = await readFile('.env', 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      if (match) existing[match[1]!] = match[2]!
    }
    console.log('📄 Tìm thấy .env hiện tại, giá trị cũ sẽ là mặc định.\n')
  }

  const mask = (val?: string) => val ? val.slice(0, 6) + '...' + val.slice(-4) : ''

  const fields = [
    { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', required: true },
    { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', required: false },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', required: false },
    { key: 'GOOGLE_API_KEY', label: 'Google API Key', required: false },
    { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API Key', required: false },
    { key: 'ALLOWED_USERS', label: 'Telegram User ID (của bạn)', required: false },
  ]

  const values: Record<string, string> = {}

  for (const field of fields) {
    const current = existing[field.key]
    const hint = current ? ` [hiện tại: ${mask(current)}]` : field.required ? ' (bắt buộc)' : ' (bỏ trống nếu không dùng)'
    const answer = await ask(`  ${field.label}${hint}: `)
    values[field.key] = answer.trim() || current || ''
  }

  // Validate
  if (!values.TELEGRAM_BOT_TOKEN) {
    rl.close()
    console.log('\n❌ TELEGRAM_BOT_TOKEN là bắt buộc!')
    process.exit(1)
  }

  // --- Model picker based on which API keys were provided ---
  type ModelEntry = { id: string; name: string; provider: string }
  const availableModels: ModelEntry[] = []

  // Static models for direct providers
  if (values.OPENAI_API_KEY) {
    availableModels.push(
      { id: 'gpt-4o', name: 'GPT-4o (recommended)', provider: 'OpenAI' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (fast & cheap)', provider: 'OpenAI' },
      { id: 'o3-mini', name: 'o3 Mini (reasoning)', provider: 'OpenAI' },
    )
  }
  if (values.ANTHROPIC_API_KEY) {
    availableModels.push(
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (latest)', provider: 'Anthropic' },
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (fast)', provider: 'Anthropic' },
    )
  }
  if (values.GOOGLE_API_KEY) {
    availableModels.push(
      { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'Google' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (fast)', provider: 'Google' },
    )
  }

  // Fetch OpenRouter models from API
  // Fetch ALL OpenRouter models from API
  let allOpenRouterModels: ModelEntry[] = []
  if (values.OPENROUTER_API_KEY) {
    console.log('\n  ⏳ Đang tải danh sách model từ OpenRouter...')
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${values.OPENROUTER_API_KEY}` },
      })
      if (res.ok) {
        const data = await res.json() as { data: Array<{ id: string; name: string; pricing?: { prompt?: string } }> }
        allOpenRouterModels = data.data
          .filter(m => m.name && m.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(m => {
            const isFree = m.pricing?.prompt === '0' || m.pricing?.prompt === '0.0'
            return {
              id: `openrouter/${m.id}`,
              name: `${m.name}${isFree ? ' [FREE]' : ''}`,
              provider: 'OpenRouter',
            }
          })
        console.log(`  ✅ ${allOpenRouterModels.length} model từ OpenRouter`)
      } else {
        console.log('  ⚠️  Không thể tải từ OpenRouter (API error)')
      }
    } catch {
      console.log('  ⚠️  Lỗi kết nối OpenRouter')
    }
  }

  let selectedModel = existing.DEFAULT_MODEL || 'gpt-4o'

  // Direct provider models (always shown)
  const directModels = availableModels // OpenAI, Anthropic, Google

  if (directModels.length > 0 || allOpenRouterModels.length > 0) {
    console.log('\n🤖 Chọn model mặc định:\n')

    // Show direct provider models with numbers
    let index = 0
    if (directModels.length > 0) {
      const providers = [...new Set(directModels.map(m => m.provider))]
      for (const provider of providers) {
        console.log(`  ── ${provider} ──`)
        const group = directModels.filter(m => m.provider === provider)
        for (const m of group) {
          index++
          const current = m.id === selectedModel ? ' ← hiện tại' : ''
          console.log(`  ${String(index).padStart(3, ' ')}. ${m.name}${current}`)
        }
        console.log('')
      }
    }

    // OpenRouter: show search instead of listing 200+ models
    if (allOpenRouterModels.length > 0) {
      console.log(`  ── OpenRouter (${allOpenRouterModels.length} models) ──`)
      console.log(`    s. 🔍 Tìm kiếm model OpenRouter`)
      console.log(`    a. 📋 Xem tất cả model OpenRouter`)
      console.log('')
    }

    console.log(`    0. ✏️  Nhập model ID thủ công\n`)

    const choice = await ask('  Chọn (số / s / a / 0): ')

    if (choice.trim().toLowerCase() === 's') {
      // Search mode
      const keyword = await ask('  🔍 Nhập từ khóa (vd: claude, gpt, llama, deepseek, gemini): ')
      const kw = keyword.trim().toLowerCase()
      const filtered = allOpenRouterModels.filter(m =>
        m.name.toLowerCase().includes(kw) || m.id.toLowerCase().includes(kw)
      )

      if (filtered.length === 0) {
        console.log(`\n  Không tìm thấy model với "${keyword}". Giữ nguyên: ${selectedModel}`)
      } else {
        console.log(`\n  Tìm thấy ${filtered.length} model:\n`)
        filtered.forEach((m, i) => {
          const current = m.id === selectedModel ? ' ← hiện tại' : ''
          console.log(`  ${String(i + 1).padStart(3, ' ')}. ${m.name}${current}`)
          console.log(`       ${m.id}`)
        })
        console.log('')
        const pick = await ask('  Chọn số (Enter = giữ nguyên): ')
        const pickNum = parseInt(pick)
        if (pickNum >= 1 && pickNum <= filtered.length) {
          selectedModel = filtered[pickNum - 1]!.id
        }
      }
    } else if (choice.trim().toLowerCase() === 'a') {
      // Show all with pagination
      const pageSize = 30
      let page = 0
      const totalPages = Math.ceil(allOpenRouterModels.length / pageSize)

      while (true) {
        const start = page * pageSize
        const end = Math.min(start + pageSize, allOpenRouterModels.length)
        console.log(`\n  ── OpenRouter [${start + 1}-${end}/${allOpenRouterModels.length}] ──\n`)

        for (let i = start; i < end; i++) {
          const m = allOpenRouterModels[i]!
          const current = m.id === selectedModel ? ' ← hiện tại' : ''
          console.log(`  ${String(i + 1).padStart(4, ' ')}. ${m.name}${current}`)
        }

        console.log('')
        const nav = page < totalPages - 1
          ? '  Nhập số để chọn, Enter = trang tiếp, q = thoát: '
          : '  Nhập số để chọn, q = thoát: '
        const input = await ask(nav)

        if (input.trim().toLowerCase() === 'q' || input.trim() === '') {
          if (input.trim() === '' && page < totalPages - 1) {
            page++
            continue
          }
          break
        }

        const pickNum = parseInt(input)
        if (pickNum >= 1 && pickNum <= allOpenRouterModels.length) {
          selectedModel = allOpenRouterModels[pickNum - 1]!.id
          break
        }
      }
    } else if (choice.trim() === '0') {
      const custom = await ask('  Nhập model ID: ')
      if (custom.trim()) selectedModel = custom.trim()
    } else {
      const num = parseInt(choice)
      if (num >= 1 && num <= directModels.length) {
        selectedModel = directModels[num - 1]!.id
      }
    }
  } else {
    console.log('\n⚠️  Chưa có API key nào → sẽ dùng Ollama local.')
    selectedModel = 'ollama/llama3'
  }

  rl.close()



  console.log(`\n✅ Model đã chọn: ${selectedModel}`)

  // Write .env
  const envContent = [
    '# Quasar Agent — Auto-generated by `quasar setup`',
    `# Generated: ${new Date().toISOString()}`,
    '',
    `TELEGRAM_BOT_TOKEN=${values.TELEGRAM_BOT_TOKEN}`,
    '',
    '# AI Providers',
    `OPENAI_API_KEY=${values.OPENAI_API_KEY || ''}`,
    `ANTHROPIC_API_KEY=${values.ANTHROPIC_API_KEY || ''}`,
    `GOOGLE_API_KEY=${values.GOOGLE_API_KEY || ''}`,
    `OPENROUTER_API_KEY=${values.OPENROUTER_API_KEY || ''}`,
    '',
    '# Settings',
    `ALLOWED_USERS=${values.ALLOWED_USERS || ''}`,
    `DEFAULT_MODEL=${selectedModel}`,
  ].join('\n')

  await writeFile('.env', envContent, 'utf-8')
  console.log('✅ Đã lưu vào .env')
  console.log('🚀 Chạy `pnpm start` để khởi động bot!\n')
}


// --- Quick model switch (reuse setup logic but skip API key prompts) ---
async function switchModel() {
  console.log(BANNER)

  const { createInterface } = await import('readline')
  const { writeFile, readFile } = await import('fs/promises')
  const { existsSync } = await import('fs')

  if (!existsSync('.env')) {
    console.log('❌ Chưa có .env — chạy `pnpm run init:config` trước.')
    process.exit(1)
  }

  // Read existing .env
  const content = await readFile('.env', 'utf-8')
  const env: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match) env[match[1]!] = match[2]!
  }

  const currentModel = env.DEFAULT_MODEL || 'gpt-4o'
  console.log(`Model hiện tại: ${currentModel}\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res))

  type ModelEntry = { id: string; name: string; provider: string }
  const models: ModelEntry[] = []

  // Direct providers
  if (env.OPENAI_API_KEY) {
    models.push(
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
      { id: 'o3-mini', name: 'o3 Mini', provider: 'OpenAI' },
    )
  }
  if (env.ANTHROPIC_API_KEY) {
    models.push(
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic' },
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'Anthropic' },
    )
  }
  if (env.GOOGLE_API_KEY) {
    models.push(
      { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'Google' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google' },
    )
  }

  // OpenRouter
  let orModels: ModelEntry[] = []
  if (env.OPENROUTER_API_KEY) {
    try {
      console.log('⏳ Tải model từ OpenRouter...')
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${env.OPENROUTER_API_KEY}` },
      })
      if (res.ok) {
        const data = await res.json() as { data: Array<{ id: string; name: string; pricing?: { prompt?: string } }> }
        orModels = data.data
          .filter(m => m.name && m.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(m => ({
            id: `openrouter/${m.id}`,
            name: `${m.name}${(m.pricing?.prompt === '0' || m.pricing?.prompt === '0.0') ? ' [FREE]' : ''}`,
            provider: 'OpenRouter',
          }))
        console.log(`✅ ${orModels.length} model\n`)
      }
    } catch { /* ignore */ }
  }

  // Display
  let index = 0
  const providers = [...new Set(models.map(m => m.provider))]
  for (const p of providers) {
    console.log(`── ${p} ──`)
    for (const m of models.filter(m => m.provider === p)) {
      index++
      const cur = m.id === currentModel ? ' ← hiện tại' : ''
      console.log(`  ${index}. ${m.name}${cur}`)
    }
  }

  if (orModels.length > 0) {
    console.log(`\n── OpenRouter (${orModels.length} models) ──`)
    console.log(`  s. 🔍 Tìm kiếm`)
  }
  console.log(`  0. Nhập thủ công\n`)

  const choice = await ask('Chọn: ')
  let selectedModel = currentModel

  if (choice.trim().toLowerCase() === 's' && orModels.length > 0) {
    const kw = (await ask('Từ khóa: ')).trim().toLowerCase()
    const filtered = orModels.filter(m => m.name.toLowerCase().includes(kw) || m.id.toLowerCase().includes(kw))
    if (filtered.length === 0) {
      console.log('Không tìm thấy.')
    } else {
      filtered.forEach((m, i) => console.log(`  ${i + 1}. ${m.name}\n     ${m.id}`))
      const pick = parseInt(await ask('\nChọn số: '))
      if (pick >= 1 && pick <= filtered.length) selectedModel = filtered[pick - 1]!.id
    }
  } else if (choice.trim() === '0') {
    const custom = (await ask('Model ID: ')).trim()
    if (custom) selectedModel = custom
  } else {
    const num = parseInt(choice)
    if (num >= 1 && num <= models.length) selectedModel = models[num - 1]!.id
  }

  rl.close()

  // Update .env — only change DEFAULT_MODEL line
  const newContent = content.replace(/^DEFAULT_MODEL=.*$/m, `DEFAULT_MODEL=${selectedModel}`)
  await writeFile('.env', newContent, 'utf-8')
  console.log(`\n✅ Model đổi thành: ${selectedModel}`)
  console.log('🚀 Restart bot để áp dụng: pnpm start\n')
}

// CLI
const command = process.argv[2] || 'start'

switch (command) {
  case 'start':
    start().catch((e) => {
      log.error('Failed to start:', e)
      process.exit(1)
    })
    break

  case 'setup':
    setup().catch((e) => {
      log.error('Setup failed:', e)
      process.exit(1)
    })
    break

  case 'model':
    switchModel().catch((e) => {
      log.error('Model switch failed:', e)
      process.exit(1)
    })
    break

  case 'help':
    console.log(BANNER)
    console.log('Commands:')
    console.log('  start     Start the Quasar agent (default)')
    console.log('  setup     Interactive API key + model configuration')
    console.log('  model     Quick model switch (không cần nhập lại API key)')
    console.log('  help      Show this help message')
    console.log('')
    console.log('Quick start:')
    console.log('  1. pnpm run init:config    ← Điền API keys + chọn model')
    console.log('  2. pnpm start              ← Chạy bot')
    console.log('  3. pnpm run model          ← Đổi model nhanh')
    break

  default:
    console.log(`Unknown command: ${command}. Run "quasar help" for usage.`)
    process.exit(1)
}
