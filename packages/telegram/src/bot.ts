// packages/telegram/src/bot.ts
// Upgrades: #7 History Management, #8 File/Photo Attachment + Vision

import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile } from 'grammy'
import type { Context } from 'grammy'
import type { QuasarConfig, SessionId } from '@quasar/core'
import { createLogger, TelegramError, eventBus } from '@quasar/core'
import type { AgentLoop } from '@quasar/agent'
import { SqliteMemory } from '@quasar/memory'
import { AllowlistManager } from '@quasar/security'
import { formatResponse, truncate } from './formatter.js'
import { TTSService } from '@quasar/media'
import OpenAI from 'openai'
import { createReadStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const log = createLogger('telegram:bot')

// Available models for /model command
const AVAILABLE_MODELS = [
  { label: 'GPT-4o', value: 'gpt-4o' },
  { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-latest' },
  { label: 'Claude 3 Haiku', value: 'claude-3-haiku-20240307' },
  { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro-preview-05-06' },
  { label: 'OR: Claude 3.5', value: 'openrouter/anthropic/claude-3.5-sonnet' },
  { label: 'OR: DeepSeek V3', value: 'openrouter/deepseek/deepseek-chat' },
  { label: 'Ollama: Llama3', value: 'ollama/llama3' },
]

export class QuasarBot {
  private bot: Bot
  private config: QuasarConfig
  private agentLoop: AgentLoop
  private memory: SqliteMemory
  private allowlist: AllowlistManager
  private sessionCache = new Map<string, SessionId>()
  private processingUsers = new Set<number>()
  private ttsService?: TTSService
  private openai?: OpenAI

  constructor(
    config: QuasarConfig,
    agentLoop: AgentLoop,
    memory: SqliteMemory,
    allowlist: AllowlistManager,
  ) {
    this.config = config
    this.agentLoop = agentLoop
    this.memory = memory
    this.allowlist = allowlist
    this.bot = new Bot(config.telegram.token)

    const openAiApiKey = config.providers.openai?.apiKey
    if (openAiApiKey) {
      this.ttsService = new TTSService(openAiApiKey)
      this.openai = new OpenAI({ apiKey: openAiApiKey })
    }

    this.setupHandlers()
    log.info('Telegram bot created')
  }

  private setupHandlers() {
    // Auth middleware
    this.bot.use(async (ctx, next) => {
      const isCallback = !!ctx.callbackQuery
      log.info(`Incoming update (hasCallbackQuery: ${isCallback}, from: ${ctx.from?.id})`)
      const userId = ctx.from?.id
      if (userId && !this.allowlist.isAllowed(userId)) {
        log.warn(`Unauthorized user: ${userId} (username: ${ctx.from?.username})`)
        await ctx.reply(`⛔ You are not authorized.\nYour ID: \`${userId}\`\nShare this ID to get access.`, { parse_mode: 'Markdown' })
        return
      }
      await next()
    })

    // Commands
    this.bot.command('start', (ctx) => this.handleStart(ctx))
    this.bot.command('new', (ctx) => this.handleNew(ctx))
    this.bot.command('status', (ctx) => this.handleStatus(ctx))
    this.bot.command('model', (ctx) => this.handleModel(ctx))
    this.bot.command('help', (ctx) => this.handleHelp(ctx))
    this.bot.command('history', (ctx) => this.handleHistory(ctx))
    this.bot.command('export', (ctx) => this.handleExport(ctx))
    this.bot.command('cleanup', (ctx) => this.handleCleanup(ctx))
    this.bot.command('fork', (ctx) => this.handleFork(ctx))             // #20
    this.bot.command('rate', (ctx) => this.handleRateStatus(ctx))       // #24

    // Callback queries (inline keyboard)
    this.bot.on('callback_query:data', (ctx) => this.handleCallback(ctx))

    // Text messages
    this.bot.on('message:text', (ctx) => this.handleMessage(ctx))

    // Voice messages
    this.bot.on('message:voice', (ctx) => this.handleVoiceMessage(ctx))

    // Photo messages (#8)
    this.bot.on('message:photo', (ctx) => this.handlePhotoMessage(ctx))

    // Document messages (#8)
    this.bot.on('message:document', (ctx) => this.handleDocumentMessage(ctx))

    // Error handler
    this.bot.catch((err) => {
      if (err.error instanceof GrammyError) {
        log.error('Telegram API error:', err.error.message)
      } else if (err.error instanceof HttpError) {
        log.error('Network error:', err.error.message)
      } else {
        log.error('Bot error:', err.error)
      }
    })
  }

  private async handleStart(ctx: Context) {
    await ctx.reply(
      `🚀 **Quasar AI Agent**\n\n` +
      `Xin chào! Tôi là Quasar — trợ lý AI cá nhân của bạn.\n\n` +
      `**Commands:**\n` +
      `/new — Tạo hội thoại mới\n` +
      `/model — Đổi AI model\n` +
      `/status — Xem trạng thái\n` +
      `/history — Xem lịch sử hội thoại\n` +
      `/export — Xuất hội thoại hiện tại\n` +
      `/fork — Phân nhánh hội thoại hiện tại\n` +
      `/rate — Xem rate limit status\n` +
      `/help — Hướng dẫn\n\n` +
      `Gửi tin nhắn, ảnh, hoặc file để bắt đầu!`,
      { parse_mode: 'Markdown' }
    )
  }

  private async handleNew(ctx: Context) {
    const userId = ctx.from!.id
    const chatId = ctx.chat!.id
    const cacheKey = `${userId}:${chatId}`
    this.sessionCache.delete(cacheKey)
    await ctx.reply('🆕 Hội thoại mới đã được tạo.')
  }

  private async handleStatus(ctx: Context) {
    const userId = ctx.from!.id
    const model = this.agentLoop.getModel()
    const sessionCount = this.memory.getSessionCount(userId)
    const tools = this.agentLoop.getToolDefs()
    // Token usage (#5)
    const usage = this.memory.getTotalTokenUsage(userId)
    const estimatedCost = (usage.totalTokens / 1_000_000 * 3).toFixed(4) // rough avg $3/M tokens

    await ctx.reply(
      `📊 **Trạng thái Quasar**\n\n` +
      `🤖 Model: \`${model}\`\n` +
      `💬 Sessions: ${sessionCount}\n` +
      `🛠️ Tools: ${tools.length} (${tools.map(t => t.name).join(', ')})\n` +
      `📊 Tokens used: ${usage.totalTokens.toLocaleString()} (~$${estimatedCost})\n` +
      `⏱️ Uptime: ${Math.floor(process.uptime())}s`,
      { parse_mode: 'Markdown' }
    )
  }

  private async handleModel(ctx: Context) {
    const keyboard = new InlineKeyboard()
    const currentModel = this.agentLoop.getModel()

    for (let i = 0; i < AVAILABLE_MODELS.length; i++) {
      const m = AVAILABLE_MODELS[i]!
      const isCurrent = m.value === currentModel ? ' ✅' : ''
      keyboard.text(`${m.label}${isCurrent}`, `model:${m.value}`)
      if ((i + 1) % 2 === 0) keyboard.row()
    }

    await ctx.reply('🤖 Chọn AI model:', { reply_markup: keyboard })
  }

  private async handleHelp(ctx: Context) {
    await ctx.reply(
      `📖 **Hướng dẫn sử dụng Quasar**\n\n` +
      `**Chat:**\n` +
      `Gửi tin nhắn bất kỳ để chat với AI.\n\n` +
      `**Gửi ảnh / file:**\n` +
      `📷 Gửi ảnh → AI sẽ phân tích bằng Vision\n` +
      `📎 Gửi file → AI sẽ đọc nội dung\n\n` +
      `**Commands:**\n` +
      `/new — Xóa context, bắt đầu hội thoại mới\n` +
      `/model — Đổi AI model (GPT, Claude, Gemini...)\n` +
      `/status — Xem model, tools, sessions, token usage\n` +
      `/history — Xem danh sách hội thoại gần đây\n` +
      `/export — Xuất hội thoại hiện tại ra text\n` +
      `/cleanup — Dọn dẹp sessions cũ\n\n` +
      `**AI có thể:**\n` +
      `• Chạy lệnh PowerShell\n` +
      `• Đọc/ghi/sửa file\n` +
      `• Tìm kiếm web\n` +
      `• Đọc PDF\n` +
      `• Phân tích ảnh (Vision)\n` +
      `• Tạo ảnh / TTS\n` +
      `• Và nhiều hơn nữa...`,
      { parse_mode: 'Markdown' }
    )
  }

  // --- History Management (#7) ---

  private async handleHistory(ctx: Context) {
    const userId = ctx.from!.id
    const sessions = this.memory.listSessions(userId, 10)

    if (sessions.length === 0) {
      await ctx.reply('📭 Chưa có hội thoại nào.')
      return
    }

    const lines = sessions.map((s, i) => {
      const date = new Date(s.updatedAt).toLocaleDateString('vi-VN')
      const tokens = s.totalTokens > 0 ? ` (${s.totalTokens.toLocaleString()} tokens)` : ''
      return `${i + 1}. 💬 *${s.title}*\n   ${date} — ${s.messageCount} tin nhắn${tokens}\n   \`${s.id.slice(0, 8)}\` | ${s.model}`
    })

    await ctx.reply(
      `📜 **Lịch sử hội thoại (${sessions.length} gần nhất)**\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    )
  }

  private async handleExport(ctx: Context) {
    const userId = ctx.from!.id
    const chatId = ctx.chat!.id
    const cacheKey = `${userId}:${chatId}`
    const sessionId = this.sessionCache.get(cacheKey)

    if (!sessionId) {
      await ctx.reply('⚠️ Chưa có hội thoại nào đang mở. Gửi tin nhắn trước.')
      return
    }

    const exported = this.memory.exportSession(sessionId)
    if (!exported) {
      await ctx.reply('⚠️ Không tìm thấy session.')
      return
    }

    const { session, tokenUsage } = exported
    const lines = [
      `# Quasar Chat Export`,
      `Model: ${session.model}`,
      `Date: ${new Date(session.createdAt).toISOString()}`,
      `Tokens: ${tokenUsage.totalTokens.toLocaleString()}`,
      `---`,
      ...session.messages
        .filter(m => m.role !== 'tool')
        .map(m => `**${m.role === 'user' ? '👤 You' : '🤖 Quasar'}:**\n${m.content}`),
    ]

    const text = lines.join('\n\n')
    if (text.length > 4000) {
      // Send as file
      const tempDir = resolve('./data/temp')
      await mkdir(tempDir, { recursive: true })
      const filePath = resolve(tempDir, `chat_${sessionId.slice(0, 8)}.md`)
      await writeFile(filePath, text)
      await ctx.replyWithDocument(new InputFile(filePath))
    } else {
      await ctx.reply(text)
    }
  }

  private async handleCleanup(ctx: Context) {
    const userId = ctx.from!.id
    const deleted = this.memory.cleanupOldSessions(userId, 30)
    await ctx.reply(`🧹 Đã xóa ${deleted} hội thoại cũ hơn 30 ngày.`)
  }

  // --- Fork Session (#20) ---

  private async handleFork(ctx: Context) {
    const userId = ctx.from!.id
    const chatId = ctx.chat!.id
    const cacheKey = `${userId}:${chatId}`
    const sessionId = this.sessionCache.get(cacheKey)

    if (!sessionId) {
      await ctx.reply('⚠️ Chưa có hội thoại nào để fork. Gửi tin nhắn trước.')
      return
    }

    try {
      const forked = this.memory.forkSession(sessionId, userId, chatId)
      if (!forked) {
        await ctx.reply('⚠️ Không thể fork session.')
        return
      }
      this.sessionCache.set(cacheKey, forked.id)
      await ctx.reply(
        `🍴 Session đã được fork!\n` +
        `Original: \`${sessionId.slice(0, 8)}\`\n` +
        `Fork: \`${forked.id.slice(0, 8)}\`\n\n` +
        `Bạn đang ở session mới với toàn bộ context cũ. Tiếp tục chat để thử hướng khác.`,
        { parse_mode: 'Markdown' }
      )
    } catch (e) {
      await ctx.reply(`❌ Fork failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // --- Rate Limit Status (#24) ---

  private async handleRateStatus(ctx: Context) {
    const userId = ctx.from!.id
    const status = this.memory.getRateLimitStatus(userId)
    const usage = this.memory.getTotalTokenUsage(userId)

    await ctx.reply(
      `📊 **Rate Limit Status**\n\n` +
      `⚡ Requests/phút: ${status.requestsThisMinute}/20\n` +
      `🎫 Tokens hôm nay: ${status.tokensToday.toLocaleString()}/500,000\n` +
      `📊 Tổng tokens: ${usage.totalTokens.toLocaleString()}\n` +
      `💰 Chi phí ước tính: ~$${(usage.totalTokens / 1_000_000 * 3).toFixed(4)}`,
      { parse_mode: 'Markdown' }
    )
  }

  // --- Photo/Document Handling (#8) ---

  private async handlePhotoMessage(ctx: Context) {
    const userId = ctx.from!.id
    const chatId = ctx.chat!.id

    if (this.processingUsers.has(userId)) {
      await ctx.reply('⏳ Đang xử lý tin nhắn trước đó...')
      return
    }

    this.processingUsers.add(userId)
    let typingInterval: NodeJS.Timeout | null = null

    try {
      await ctx.replyWithChatAction('typing')
      typingInterval = setInterval(async () => {
        try { await ctx.replyWithChatAction('typing') } catch {}
      }, 4000)

      // Get the largest photo
      const photos = ctx.message!.photo!
      const photo = photos[photos.length - 1]!
      const file = await ctx.getFile()
      const fileUrl = `https://api.telegram.org/file/bot${this.config.telegram.token}/${file.file_path}`

      // Download photo
      const fileRes = await fetch(fileUrl)
      if (!fileRes.ok) throw new Error('Failed to download photo')
      const buffer = Buffer.from(await fileRes.arrayBuffer())
      const base64 = buffer.toString('base64')

      const caption = ctx.message!.caption || 'Hãy phân tích ảnh này.'

      const sessionId = await this.getOrCreateSession(userId, chatId)
      const imageUrl = `data:image/jpeg;base64,${base64}`

      // Process with streaming (#25) and vision (#19)
      let fullResponse = ''
      let sentMessageId: number | null = null
      let lastUpdate = 0
      
      const placeholder = await ctx.reply('⏳ Đang phân tích ảnh...')
      sentMessageId = placeholder.message_id

      let toolInfo = ''
      const toolListener = (e: any) => { toolInfo = `\n\n🛠️ _${e.tool}..._` }
      const toolDoneListener = (e: any) => { toolInfo = '' }
      eventBus.on('tool:call', toolListener)
      eventBus.on('tool:result', toolDoneListener)

      const response = await this.agentLoop.process(sessionId, caption, {
        stream: true,
        images: [imageUrl],
        onChunk: async (chunk) => {
          fullResponse += chunk
          const now = Date.now()
          if (now - lastUpdate > 500 && sentMessageId) {
            lastUpdate = now
            try {
              const preview = formatResponse(fullResponse + ' ▌') + toolInfo
              await this.bot.api.editMessageText(chatId, sentMessageId, preview)
            } catch { /* ignore */ }
          }
        },
      })

      eventBus.off('tool:call', toolListener)
      eventBus.off('tool:result', toolDoneListener)

      if (typingInterval) clearInterval(typingInterval)
      
      const finalText = formatResponse(response || fullResponse)
      if (sentMessageId) {
        try {
          await this.bot.api.editMessageText(chatId, sentMessageId, finalText)
        } catch { /* ignore */ }
      } else {
        await ctx.reply(finalText)
      }
    } catch (e) {
      if (typingInterval) clearInterval(typingInterval)
      log.error('Photo handling error:', e)
      await ctx.reply(`❌ Lỗi xử lý ảnh: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.processingUsers.delete(userId)
    }
  }

  private async handleDocumentMessage(ctx: Context) {
    const userId = ctx.from!.id
    const chatId = ctx.chat!.id

    if (this.processingUsers.has(userId)) {
      await ctx.reply('⏳ Đang xử lý tin nhắn trước đó...')
      return
    }

    this.processingUsers.add(userId)
    let typingInterval: NodeJS.Timeout | null = null

    try {
      await ctx.replyWithChatAction('typing')
      typingInterval = setInterval(async () => {
        try { await ctx.replyWithChatAction('typing') } catch {}
      }, 4000)

      const doc = ctx.message!.document!
      const file = await ctx.getFile()
      const fileUrl = `https://api.telegram.org/file/bot${this.config.telegram.token}/${file.file_path}`

      // Download file
      const fileRes = await fetch(fileUrl)
      if (!fileRes.ok) throw new Error('Failed to download file')
      const buffer = Buffer.from(await fileRes.arrayBuffer())

      // Save to temp
      const tempDir = resolve('./data/temp')
      await mkdir(tempDir, { recursive: true })
      const filePath = resolve(tempDir, doc.file_name || 'uploaded_file')
      await writeFile(filePath, buffer)

      const caption = ctx.message!.caption || ''

      // Try to read as text
      let fileContent = ''
      try {
        fileContent = buffer.toString('utf-8').slice(0, 10_000)
        // Check if it's actually text (not binary garbage)
        const nonPrintable = fileContent.replace(/[\x20-\x7E\n\r\t\u00A0-\uFFFF]/g, '').length
        if (nonPrintable / fileContent.length > 0.1) {
          fileContent = `(Binary file: ${doc.mime_type}, ${Math.round(buffer.length / 1024)}KB)`
        }
      } catch {
        fileContent = `(Binary file: ${doc.mime_type}, ${Math.round(buffer.length / 1024)}KB)`
      }

      const sessionId = await this.getOrCreateSession(userId, chatId)
      const prompt = caption
        ? `Người dùng gửi file "${doc.file_name}" (${doc.mime_type}). Caption: "${caption}"\n\nNội dung file:\n\`\`\`\n${fileContent}\n\`\`\``
        : `Người dùng gửi file "${doc.file_name}" (${doc.mime_type}, ${Math.round(buffer.length / 1024)}KB). Hãy phân tích nội dung:\n\`\`\`\n${fileContent}\n\`\`\``

      const response = await this.agentLoop.process(sessionId, prompt)

      if (typingInterval) clearInterval(typingInterval)
      await ctx.reply(formatResponse(response))
    } catch (e) {
      if (typingInterval) clearInterval(typingInterval)
      log.error('Document handling error:', e)
      await ctx.reply(`❌ Lỗi xử lý file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.processingUsers.delete(userId)
    }
  }

  private async handleCallback(ctx: Context) {
    const data = ctx.callbackQuery?.data
    log.info(`Callback query received: "${data}" from user: ${ctx.from?.id}`)

    if (!data) {
      await ctx.answerCallbackQuery()
      return
    }

    // Model selection
    if (data.startsWith('model:')) {
      const model = data.slice('model:'.length)
      // Per-session model (#6) — set for current session if exists
      const userId = ctx.from!.id
      const chatId = ctx.chat!.id
      const cacheKey = `${userId}:${chatId}`
      const sessionId = this.sessionCache.get(cacheKey)
      this.agentLoop.setModel(model, sessionId)
      await ctx.answerCallbackQuery({ text: `Đã đổi sang ${model}` })
      await ctx.editMessageText(`✅ Model đã đổi sang: \`${model}\``, { parse_mode: 'Markdown' })
      return
    }

    // Exec approval
    if (data.startsWith('approve:') || data.startsWith('deny:')) {
      const approved = data.startsWith('approve:')
      const id = data.slice(approved ? 'approve:'.length : 'deny:'.length)
      
      log.info(`Handling approval action for ID: ${id}, approved: ${approved}`)
      const resolved = this.allowlist.handleApproval(id, approved)
      log.info(`Approval resolution result: ${resolved}`)

      try {
        await ctx.answerCallbackQuery({ text: approved ? '✅ Approved' : '❌ Denied' })
      } catch (err) {
        log.warn(`Failed to answer callback query (old query?): ${err instanceof Error ? err.message : err}`)
      }

      try {
        await ctx.editMessageText(
          approved ? '✅ Command approved' : '❌ Command denied',
        )
      } catch (err) {
        log.warn(`Failed to edit message: ${err instanceof Error ? err.message : err}`)
      }
      return
    }

    await ctx.answerCallbackQuery()
  }

  private async handleMessage(ctx: Context) {
    const userId = ctx.from!.id
    const chatId = ctx.chat!.id
    const text = ctx.message!.text!

    // Prevent concurrent processing
    if (this.processingUsers.has(userId)) {
      await ctx.reply('⏳ Đang xử lý tin nhắn trước đó...')
      return
    }

    // Rate limit check (#24)
    const rateCheck = this.memory.checkRateLimit(userId)
    if (!rateCheck.allowed) {
      await ctx.reply(`🚫 ${rateCheck.reason}`)
      return
    }

    this.processingUsers.add(userId)

    // Run processing in the background without awaiting it to keep the Grammy polling loop responsive
    this.processAgentMessage(ctx, userId, chatId, text)
      .catch((error) => {
        log.error('Unhandled message processing error:', error)
      })
      .finally(() => {
        this.processingUsers.delete(userId)
      })
  }

  private async processAgentMessage(ctx: Context, userId: number, chatId: number, text: string) {
    let typingInterval: NodeJS.Timeout | null = null
    try {
      // Get or create session
      const sessionId = await this.getOrCreateSession(userId, chatId)

      // Send typing indicator
      await ctx.replyWithChatAction('typing')

      // Keep typing while processing
      typingInterval = setInterval(async () => {
        try { await ctx.replyWithChatAction('typing') } catch { /* ignore */ }
      }, 4000)

      // Process with streaming
      let fullResponse = ''
      let sentMessageChatId = chatId
      let sentMessageId: number | null = null
      let lastUpdate = 0

      // Send placeholder message with tool progress (#25)
      const placeholder = await ctx.reply('⏳ Đang xử lý...')
      sentMessageId = placeholder.message_id

      // Tool progress listener (#25)
      let toolInfo = ''
      const toolListener = (e: any) => {
        toolInfo = `\n\n🛠️ _${e.tool}..._`
      }
      const toolDoneListener = (e: any) => {
        toolInfo = ''
      }
      eventBus.on('tool:call', toolListener)
      eventBus.on('tool:result', toolDoneListener)

      const response = await this.agentLoop.process(sessionId, text, {
        stream: true,
        onChunk: async (chunk) => {
          fullResponse += chunk
          const now = Date.now()
          // Update message every 500ms (#25 — faster updates)
          if (now - lastUpdate > 500 && sentMessageId) {
            lastUpdate = now
            try {
              const preview = formatResponse(fullResponse + ' ▌') + toolInfo
              await this.bot.api.editMessageText(
                sentMessageChatId,
                sentMessageId,
                preview
              )
            } catch { /* ignore edit errors (message not modified, etc.) */ }
          }
        },
      })

      // Cleanup listeners
      eventBus.off('tool:call', toolListener)
      eventBus.off('tool:result', toolDoneListener)

      if (typingInterval) clearInterval(typingInterval)

      // Send or update final message
      const finalText = formatResponse(response || fullResponse)
      if (sentMessageId) {
        try {
          await this.bot.api.editMessageText(
            sentMessageChatId,
            sentMessageId,
            finalText,
          )
        } catch { /* ignore */ }
      } else {
        await ctx.reply(finalText)
      }
    } catch (error) {
      if (typingInterval) clearInterval(typingInterval)
      log.error('Message handling error:', error)
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async handleVoiceMessage(ctx: Context) {
    const userId = ctx.from!.id
    const chatId = ctx.chat!.id
    const voice = ctx.message!.voice!

    if (this.processingUsers.has(userId)) {
      await ctx.reply('⏳ Đang xử lý tin nhắn trước đó...')
      return
    }

    if (!this.openai || !this.ttsService) {
      await ctx.reply('⚠️ OpenAI API Key chưa được cấu hình. Không thể xử lý tin nhắn thoại.')
      return
    }

    this.processingUsers.add(userId)

    let typingInterval: NodeJS.Timeout | null = null
    try {
      await ctx.replyWithChatAction('record_voice')
      typingInterval = setInterval(async () => {
        try { await ctx.replyWithChatAction('record_voice') } catch {}
      }, 4000)

      // Get voice file from Telegram
      const file = await ctx.getFile()
      const fileUrl = `https://api.telegram.org/file/bot${this.config.telegram.token}/${file.file_path}`

      const tempDir = resolve('./data/temp')
      await mkdir(tempDir, { recursive: true })
      const tempOggPath = resolve(tempDir, `${voice.file_unique_id}.ogg`)

      const fileRes = await fetch(fileUrl)
      if (!fileRes.ok) throw new Error('Failed to download voice file')
      const buffer = Buffer.from(await fileRes.arrayBuffer())
      await writeFile(tempOggPath, buffer)

      // Transcribe using Whisper
      log.info('Transcribing voice message using Whisper...')
      const transcription = await this.openai.audio.transcriptions.create({
        file: createReadStream(tempOggPath),
        model: 'whisper-1',
        language: 'vi',
      })

      const text = transcription.text.trim()
      log.info(`Transcribed: "${text}"`)

      if (!text) {
        if (typingInterval) clearInterval(typingInterval)
        await ctx.reply('🔇 Tôi không nghe rõ bạn nói gì. Vui lòng nói lại.')
        return
      }

      await ctx.reply(`🎙️ *Bạn nói:* _${text}_`, { parse_mode: 'Markdown' })

      // Process through Agent
      const sessionId = await this.getOrCreateSession(userId, chatId)
      const response = await this.agentLoop.process(sessionId, text)

      // Synthesize to TTS
      log.info('Synthesizing agent response to speech...')
      const tempMp3Path = resolve(tempDir, `${voice.file_unique_id}_res.mp3`)
      await this.ttsService.synthesize(response, tempMp3Path, 'nova')

      if (typingInterval) clearInterval(typingInterval)

      // Send speech response back
      await ctx.replyWithVoice(new InputFile(tempMp3Path))
    } catch (e) {
      if (typingInterval) clearInterval(typingInterval)
      log.error('Voice handling error:', e)
      await ctx.reply(`❌ Lỗi xử lý giọng nói: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.processingUsers.delete(userId)
    }
  }

  async sendMessage(userId: number, text: string, options?: any): Promise<void> {
    await this.bot.api.sendMessage(userId, text, options)
  }

  private async getOrCreateSession(userId: number, chatId: number): Promise<SessionId> {
    const cacheKey = `${userId}:${chatId}`
    let sessionId = this.sessionCache.get(cacheKey)

    if (!sessionId) {
      const existing = this.memory.getLatestSession(userId, chatId)
      if (existing) {
        sessionId = existing.id
      } else {
        const session = this.memory.createSession(userId, chatId, this.agentLoop.getModel())
        sessionId = session.id
      }
      this.sessionCache.set(cacheKey, sessionId)
    }

    return sessionId
  }

  /** Send approval request to user via inline keyboard */
  async sendApprovalRequest(userId: number, approvalId: string, command: string): Promise<void> {
    const keyboard = new InlineKeyboard()
      .text('✅ Approve', `approve:${approvalId}`)
      .text('❌ Deny', `deny:${approvalId}`)

    await this.bot.api.sendMessage(
      userId,
      `🔐 **Exec Approval Required**\n\n\`\`\`\n${truncate(command, 500)}\n\`\`\`\n\nApprove this command?`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    )
  }

  async start(): Promise<void> {
    log.info('Starting Telegram bot...')
    await this.bot.start({
      onStart: (info) => {
        log.info(`Bot started: @${info.username}`)
      },
    })
  }

  async stop(): Promise<void> {
    await this.bot.stop()
    log.info('Bot stopped')
  }
}
