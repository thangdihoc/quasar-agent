// packages/telegram/src/bot.ts

import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import type { QuasarConfig, SessionId } from '@quasar/core'
import { createLogger, TelegramError } from '@quasar/core'
import type { AgentLoop } from '@quasar/agent'
import { SqliteMemory } from '@quasar/memory'
import { AllowlistManager } from '@quasar/security'
import { formatResponse, truncate } from './formatter.js'

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

    // Callback queries (inline keyboard)
    this.bot.on('callback_query:data', (ctx) => this.handleCallback(ctx))

    // Text messages
    this.bot.on('message:text', (ctx) => this.handleMessage(ctx))

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
      `/help — Hướng dẫn\n\n` +
      `Gửi tin nhắn để bắt đầu chat!`,
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

    await ctx.reply(
      `📊 **Trạng thái Quasar**\n\n` +
      `🤖 Model: \`${model}\`\n` +
      `💬 Sessions: ${sessionCount}\n` +
      `🛠️ Tools: ${tools.length} (${tools.map(t => t.name).join(', ')})\n` +
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
      `**Commands:**\n` +
      `/new — Xóa context, bắt đầu hội thoại mới\n` +
      `/model — Đổi AI model (GPT, Claude, Gemini...)\n` +
      `/status — Xem model, tools, sessions\n\n` +
      `**AI có thể:**\n` +
      `• Chạy lệnh PowerShell\n` +
      `• Đọc/ghi/sửa file\n` +
      `• Tìm kiếm web\n` +
      `• Đọc PDF\n` +
      `• Và nhiều hơn nữa...`,
      { parse_mode: 'Markdown' }
    )
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
      this.agentLoop.setModel(model)
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
      let sentMessageChatId: number | null = null
      let sentMessageId: number | null = null
      let lastUpdate = 0

      const response = await this.agentLoop.process(sessionId, text, {
        stream: true,
        onChunk: async (chunk) => {
          fullResponse += chunk
          const now = Date.now()
          // Update message every 500ms
          if (now - lastUpdate > 500 && sentMessageId) {
            lastUpdate = now
            try {
              await this.bot.api.editMessageText(
                sentMessageChatId!,
                sentMessageId,
                formatResponse(fullResponse + ' ▌')
              )
            } catch { /* ignore edit errors */ }
          }
        },
      })

      if (typingInterval) clearInterval(typingInterval)

      // Send or update final message
      const finalText = formatResponse(response || fullResponse)
      if (sentMessageId) {
        try {
          await this.bot.api.editMessageText(
            sentMessageChatId!,
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
