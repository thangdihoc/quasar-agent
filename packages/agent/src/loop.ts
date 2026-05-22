// packages/agent/src/loop.ts
// Agent loop v0.3.0
// Upgrades: #3 parallel tools, #5 token tracking, #6 per-session model,
// #17 error recovery, #21 tool caching, #23 auto-title

import type { QuasarConfig, SessionMessage, ToolDef, SessionId, ProviderName } from '@quasar/core'
import { createLogger, eventBus, traceContext, toolCache, toolCacheKey } from '@quasar/core'
import { SqliteMemory, LanceDBMemory } from '@quasar/memory'
import { createProvider, detectProvider, stripModelPrefix, type IProvider } from './providers/index.js'
import { buildSystemPrompt } from './prompt.js'
import { buildContextWindow, estimateTokens, truncateToolOutput } from './context.js'

const log = createLogger('agent:loop')

const MAX_TOOL_ROUNDS = 15
const MAX_CONTEXT_TOKENS = 120_000

export class AgentLoop {
  private config: QuasarConfig
  private memory: SqliteMemory
  private vectorMemory?: LanceDBMemory
  private providerCache = new Map<string, IProvider>()
  private toolDefs: ToolDef[] = []
  private toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string>>()
  private defaultModel: string
  private sessionModels = new Map<SessionId, string>()

  constructor(config: QuasarConfig, memory: SqliteMemory, vectorMemory?: LanceDBMemory) {
    this.config = config
    this.memory = memory
    this.vectorMemory = vectorMemory
    this.defaultModel = config.agent.model
    log.info(`Agent loop initialized with default model: ${this.defaultModel}`)
  }

  registerTool(def: ToolDef, handler: (args: Record<string, unknown>) => Promise<string>): void {
    this.toolDefs.push(def)
    this.toolHandlers.set(def.name, handler)
    log.info(`Tool registered: ${def.name}`)
  }

  getToolDefs(): ToolDef[] {
    return this.toolDefs
  }

  setModel(model: string, sessionId?: SessionId): void {
    const oldModel = sessionId ? this.getModel(sessionId) : this.defaultModel
    if (sessionId) {
      this.sessionModels.set(sessionId, model)
    } else {
      this.defaultModel = model
      this.config.agent.model = model
    }
    eventBus.emit('model:switch', { type: 'model:switch', from: oldModel, to: model })
    log.info(`Model switched to: ${model}${sessionId ? ` (session: ${sessionId})` : ' (default)'}`)
  }

  updateProviders(providers: Record<string, { apiKey?: string; baseUrl?: string }>) {
    for (const [name, provConfig] of Object.entries(providers)) {
      const providerName = name as ProviderName
      if (!this.config.providers[providerName]) {
        this.config.providers[providerName] = {}
      }
      const existing = this.config.providers[providerName]!
      
      if (provConfig.apiKey !== undefined) {
        const key = provConfig.apiKey.trim()
        const isMasked = key.includes('...') || key === '********'
        if (!isMasked) {
          existing.apiKey = key || undefined
        }
      }
      
      if (provConfig.baseUrl !== undefined) {
        existing.baseUrl = provConfig.baseUrl.trim() || undefined
      }
    }
    this.providerCache.clear()
    log.info('Providers configuration updated dynamically')
  }

  getConfig(): QuasarConfig {
    return this.config
  }

  getModel(sessionId?: SessionId): string {
    if (sessionId && this.sessionModels.has(sessionId)) {
      return this.sessionModels.get(sessionId)!
    }
    return this.defaultModel
  }

  resumeSession(sessionId: SessionId): number {
    const messages = this.memory.getMessages(sessionId)
    eventBus.emit('session:resume', {
      type: 'session:resume',
      sessionId,
      messageCount: messages.length,
    })
    log.info(`Session resumed: ${sessionId} (${messages.length} messages)`)
    return messages.length
  }

  private getProvider(model?: string): IProvider {
    const currentModel = model || this.defaultModel
    const providerName = detectProvider(currentModel)
    const cacheKey = `${providerName}:${this.config.providers[providerName]?.apiKey || 'default'}`
    if (!this.providerCache.has(cacheKey)) {
      this.providerCache.set(cacheKey, createProvider(providerName, this.config))
    }
    return this.providerCache.get(cacheKey)!
  }

  /** Generate auto-title for a session (#23) */
  async generateTitle(sessionId: SessionId): Promise<string> {
    try {
      const messages = this.memory.getMessages(sessionId)
      const userMsgs = messages.filter(m => m.role === 'user').slice(0, 3)
      if (userMsgs.length === 0) return '(empty)'

      const preview = userMsgs.map(m => m.content.slice(0, 100)).join(' | ')

      // Use a cheap model for title generation
      const provider = this.getProvider(this.defaultModel)
      const modelName = stripModelPrefix(this.defaultModel)

      const result = await provider.complete({
        model: modelName,
        messages: [{ role: 'user', content: `Tạo tiêu đề ngắn (tối đa 10 từ) cho hội thoại này. Chỉ trả về tiêu đề, không giải thích:\n\n${preview}`, timestamp: Date.now() }],
        tools: [],
        systemPrompt: 'You are a title generator. Return ONLY a short title, nothing else.',
        maxTokens: 50,
      })

      const title = result.content.replace(/^["']|["']$/g, '').trim().slice(0, 80)
      this.memory.updateSessionTitle(sessionId, title)
      return title
    } catch (e) {
      log.warn('Auto-title generation failed:', e)
      return '(untitled)'
    }
  }

  async process(
    sessionId: SessionId,
    userMessage: string,
    opts?: { stream?: boolean; onChunk?: (text: string) => void; images?: string[] }
  ): Promise<string> {
    const traceId = traceContext.start()
    const currentModel = this.getModel(sessionId)

    this.memory.addMessage(sessionId, {
      role: 'user',
      content: userMessage,
      images: opts?.images,
      timestamp: Date.now(),
    })

    eventBus.emit('agent:start', {
      type: 'agent:start',
      sessionId,
      model: currentModel,
    })

    const provider = this.getProvider(currentModel)
    let systemPrompt = buildSystemPrompt(this.config)

    // LanceDB RAG Search
    if (this.vectorMemory) {
      try {
        const memories = await this.vectorMemory.search(userMessage, 3)
        if (memories.length > 0) {
          const contextAddition = '\n\n[Trí nhớ dài hạn tìm thấy (RAG)]:\n' +
            memories.map((m) => `- ${m.text}`).join('\n')
          systemPrompt += contextAddition
          log.info(`Found ${memories.length} relevant memories`)
        }
      } catch (e) {
        log.error('RAG memory search failed:', e)
      }
    }

    const systemPromptTokens = estimateTokens(systemPrompt)
    const modelName = stripModelPrefix(currentModel)
    let rounds = 0

    try {
      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++

        const rawMessages = this.memory.getMessages(sessionId)
        const messages = buildContextWindow(rawMessages, MAX_CONTEXT_TOKENS, systemPromptTokens)

        const result = await provider.complete({
          model: modelName,
          messages,
          tools: this.toolDefs,
          systemPrompt,
          maxTokens: this.config.agent.maxTokens,
          stream: opts?.stream,
          onChunk: opts?.onChunk,
        })

        // Token tracking (#5)
        if (result.usage) {
          this.memory.addTokenUsage(sessionId, currentModel, result.usage.promptTokens, result.usage.completionTokens, result.usage.totalTokens)
          eventBus.emit('token:usage', {
            type: 'token:usage',
            sessionId,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
            model: currentModel,
          })
        }

        // Tool calls → parallel execution with caching (#3, #21)
        if (result.toolCalls.length > 0) {
          this.memory.addMessage(sessionId, {
            role: 'assistant',
            content: result.content,
            toolCalls: result.toolCalls.map(tc => ({
              id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            })),
            timestamp: Date.now(),
          })

          const toolResults = await Promise.allSettled(
            result.toolCalls.map(async (toolCall) => {
              const handler = this.toolHandlers.get(toolCall.name)
              let toolResult: string

              eventBus.emit('tool:call', {
                type: 'tool:call',
                sessionId,
                tool: toolCall.name,
                args: toolCall.arguments,
              })

              const startTime = Date.now()

              // Tool caching (#21)
              const cacheKey = toolCacheKey(toolCall.name, toolCall.arguments)
              if (cacheKey) {
                const cached = toolCache.get(cacheKey)
                if (cached) {
                  log.info(`Tool cache hit: ${toolCall.name}`)
                  const durationMs = Date.now() - startTime
                  eventBus.emit('tool:result', {
                    type: 'tool:result', sessionId, tool: toolCall.name,
                    result: '(cached) ' + cached.slice(0, 150), durationMs, isError: false,
                  })
                  return { toolCall, toolResult: cached }
                }
              }

              if (handler) {
                try {
                  log.info(`Executing tool: ${toolCall.name}`)
                  toolResult = await handler(toolCall.arguments)
                  toolResult = truncateToolOutput(toolResult)

                  // Save to cache if cacheable (#21)
                  if (cacheKey && !toolResult.startsWith('Error:')) {
                    toolCache.set(cacheKey, toolResult)
                  }
                } catch (e) {
                  toolResult = `Error: ${e instanceof Error ? e.message : String(e)}`
                  log.error(`Tool ${toolCall.name} failed:`, e)
                }
              } else {
                toolResult = `Error: Unknown tool "${toolCall.name}"`
              }

              const durationMs = Date.now() - startTime
              eventBus.emit('tool:result', {
                type: 'tool:result', sessionId, tool: toolCall.name,
                result: toolResult.slice(0, 200), durationMs,
                isError: toolResult.startsWith('Error:'),
              })

              return { toolCall, toolResult }
            })
          )

          for (const settled of toolResults) {
            if (settled.status === 'fulfilled') {
              this.memory.addMessage(sessionId, {
                role: 'tool',
                content: settled.value.toolResult,
                toolCallId: settled.value.toolCall.id,
                timestamp: Date.now(),
              })
            } else {
              log.error('Tool execution unexpected rejection:', settled.reason)
            }
          }

          continue
        }

        // Final text response
        this.memory.addMessage(sessionId, {
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
        })

        eventBus.emit('agent:response', {
          type: 'agent:response',
          sessionId,
          content: result.content.slice(0, 200),
          rounds,
        })

        log.info(`Response generated (${rounds} round${rounds > 1 ? 's' : ''})`)
        traceContext.end()

        // Auto-title generation (#23) — on first response only
        const allMessages = this.memory.getMessages(sessionId)
        if (allMessages.filter(m => m.role === 'user').length <= 2) {
          this.generateTitle(sessionId).catch(() => {}) // fire-and-forget
        }

        return result.content
      }

      const fallback = 'Reached maximum tool execution rounds. Please try a simpler request.'
      this.memory.addMessage(sessionId, { role: 'assistant', content: fallback, timestamp: Date.now() })
      traceContext.end()
      return fallback
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      eventBus.emit('agent:error', { type: 'agent:error', sessionId, error: errorMsg })
      log.error(`Agent error: ${errorMsg}`)
      traceContext.end()

      const userFriendlyError = `⚠️ Error: ${errorMsg}`
      this.memory.addMessage(sessionId, { role: 'assistant', content: userFriendlyError, timestamp: Date.now() })
      return userFriendlyError
    }
  }
}
