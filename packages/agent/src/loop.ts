// packages/agent/src/loop.ts
// Agent loop: nhận message → gọi AI → chạy tools → trả lời

import type { QuasarConfig, SessionMessage, ToolDef, SessionId } from '@quasar/core'
import { createLogger, eventBus, traceContext } from '@quasar/core'
import { SqliteMemory } from '@quasar/memory'
import { createProvider, detectProvider, stripModelPrefix, type IProvider } from './providers/index.js'
import { buildSystemPrompt } from './prompt.js'
import { buildContextWindow, estimateTokens, truncateToolOutput } from './context.js'

const log = createLogger('agent:loop')

const MAX_TOOL_ROUNDS = 15
const MAX_CONTEXT_TOKENS = 120_000 // ~120k token window default

export class AgentLoop {
  private config: QuasarConfig
  private memory: SqliteMemory
  private providerCache = new Map<string, IProvider>()
  private toolDefs: ToolDef[] = []
  private toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string>>()
  private currentModel: string

  constructor(config: QuasarConfig, memory: SqliteMemory) {
    this.config = config
    this.memory = memory
    this.currentModel = config.agent.model
    log.info(`Agent loop initialized with model: ${this.currentModel}`)
  }

  registerTool(def: ToolDef, handler: (args: Record<string, unknown>) => Promise<string>): void {
    this.toolDefs.push(def)
    this.toolHandlers.set(def.name, handler)
    log.info(`Tool registered: ${def.name}`)
  }

  getToolDefs(): ToolDef[] {
    return this.toolDefs
  }

  setModel(model: string): void {
    const oldModel = this.currentModel
    this.currentModel = model
    eventBus.emit('model:switch', { type: 'model:switch', from: oldModel, to: model })
    log.info(`Model switched to: ${model}`)
  }

  getModel(): string {
    return this.currentModel
  }

  /** Resume an existing session — load messages from SQLite */
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

  private getProvider(): IProvider {
    const providerName = detectProvider(this.currentModel)
    const cacheKey = `${providerName}:${this.config.providers[providerName]?.apiKey || 'default'}`

    if (!this.providerCache.has(cacheKey)) {
      this.providerCache.set(cacheKey, createProvider(providerName, this.config))
    }

    return this.providerCache.get(cacheKey)!
  }

  async process(
    sessionId: SessionId,
    userMessage: string,
    opts?: { stream?: boolean; onChunk?: (text: string) => void }
  ): Promise<string> {
    const traceId = traceContext.start()

    // Save user message
    this.memory.addMessage(sessionId, {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    })

    eventBus.emit('agent:start', {
      type: 'agent:start',
      sessionId,
      model: this.currentModel,
    })

    const provider = this.getProvider()
    const systemPrompt = buildSystemPrompt(this.config)
    const systemPromptTokens = estimateTokens(systemPrompt)
    const modelName = stripModelPrefix(this.currentModel)
    let rounds = 0

    try {
      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++

        // Context engineering — manage token window
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

        // Nếu có tool calls → chạy tools
        if (result.toolCalls.length > 0) {
          // Save assistant message with tool calls
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

          // Execute each tool
          for (const toolCall of result.toolCalls) {
            const handler = this.toolHandlers.get(toolCall.name)
            let toolResult: string

            eventBus.emit('tool:call', {
              type: 'tool:call',
              sessionId,
              tool: toolCall.name,
              args: toolCall.arguments,
            })

            const startTime = Date.now()

            if (handler) {
              try {
                log.info(`Executing tool: ${toolCall.name}`)
                toolResult = await handler(toolCall.arguments)
                // Truncate long tool output
                toolResult = truncateToolOutput(toolResult)
              } catch (e) {
                toolResult = `Error: ${e instanceof Error ? e.message : String(e)}`
                log.error(`Tool ${toolCall.name} failed:`, e)
              }
            } else {
              toolResult = `Error: Unknown tool "${toolCall.name}"`
            }

            const durationMs = Date.now() - startTime

            eventBus.emit('tool:result', {
              type: 'tool:result',
              sessionId,
              tool: toolCall.name,
              result: toolResult.slice(0, 200),
              durationMs,
              isError: toolResult.startsWith('Error:'),
            })

            // Save tool result
            this.memory.addMessage(sessionId, {
              role: 'tool',
              content: toolResult,
              toolCallId: toolCall.id,
              timestamp: Date.now(),
            })
          }

          // Continue loop — AI sẽ xem kết quả tool và trả lời tiếp
          continue
        }

        // Không có tool calls → trả lời text → done
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
        return result.content
      }

      const fallback = 'Reached maximum tool execution rounds. Please try a simpler request.'
      this.memory.addMessage(sessionId, {
        role: 'assistant',
        content: fallback,
        timestamp: Date.now(),
      })
      traceContext.end()
      return fallback
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      eventBus.emit('agent:error', {
        type: 'agent:error',
        sessionId,
        error: errorMsg,
      })
      traceContext.end()
      throw e
    }
  }
}
