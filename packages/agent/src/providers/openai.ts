// packages/agent/src/providers/openai.ts
// Dùng cho: OpenAI, OpenRouter, Ollama (tất cả OpenAI-compatible API)

import OpenAI from 'openai'
import type { SessionMessage, ToolDef, ToolCall, ToolResult } from '@quasar/core'
import { ProviderError, createLogger } from '@quasar/core'

const log = createLogger('agent:openai')

export interface CompletionOptions {
  model: string
  messages: SessionMessage[]
  tools: ToolDef[]
  systemPrompt: string
  maxTokens: number
  temperature?: number
  stream?: boolean
  onChunk?: (text: string) => void
}

export interface CompletionResult {
  content: string
  toolCalls: ToolCall[]
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export class OpenAIProvider {
  private client: OpenAI
  private providerName: string = 'OpenAI'

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl })
    if (baseUrl?.includes('openrouter.ai')) {
      this.providerName = 'OpenRouter'
    } else if (baseUrl?.includes('ollama') || baseUrl?.includes('11434')) {
      this.providerName = 'Ollama'
    }
    log.info(`${this.providerName} provider initialized${baseUrl ? ` (${baseUrl})` : ''}`)
  }

  private buildMessages(systemPrompt: string, messages: SessionMessage[]): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ]

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (msg.images && msg.images.length > 0) {
          const content: OpenAI.ChatCompletionContentPart[] = [
            { type: 'text', text: msg.content || '' }
          ]
          for (const img of msg.images) {
            content.push({ type: 'image_url', image_url: { url: img } })
          }
          result.push({ role: 'user', content })
        } else {
          result.push({ role: 'user', content: msg.content })
        }
      } else if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: msg.content || null,
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          }))
        }
        result.push(assistantMsg)
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId!,
          content: msg.content,
        })
      }
    }

    return result
  }

  private buildTools(tools: ToolDef[]): OpenAI.ChatCompletionTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  async complete(opts: CompletionOptions): Promise<CompletionResult> {
    const messages = this.buildMessages(opts.systemPrompt, opts.messages)
    const tools = opts.tools.length > 0 ? this.buildTools(opts.tools) : undefined

    try {
      if (opts.stream && opts.onChunk) {
        return await this.streamComplete(messages, tools, opts)
      }

      const response = await this.client.chat.completions.create({
        model: opts.model,
        messages,
        ...(tools ? { tools } : {}),
        max_tokens: opts.maxTokens,
        temperature: opts.temperature ?? 0.7,
      })

      const choice = response.choices[0]!
      const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }))

      return {
        content: choice.message.content || '',
        toolCalls,
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
      }
    } catch (e) {
      throw new ProviderError(`${this.providerName} API error: ${e instanceof Error ? e.message : String(e)}`, e)
    }
  }

  private async streamComplete(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[] | undefined,
    opts: CompletionOptions
  ): Promise<CompletionResult> {
    const stream = await this.client.chat.completions.create({
      model: opts.model,
      messages,
      ...(tools ? { tools } : {}),
      max_tokens: opts.maxTokens,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    })

    let content = ''
    const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        content += delta.content
        opts.onChunk?.(delta.content)
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsMap.get(tc.index)
          if (existing) {
            if (tc.function?.arguments) existing.args += tc.function.arguments
          } else {
            toolCallsMap.set(tc.index, {
              id: tc.id || '',
              name: tc.function?.name || '',
              args: tc.function?.arguments || '',
            })
          }
        }
      }
    }

    const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map(tc => ({
      id: tc.id,
      name: tc.name,
      arguments: JSON.parse(tc.args || '{}'),
    }))

    return { content, toolCalls }
  }
}
