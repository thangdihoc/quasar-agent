// packages/agent/src/providers/anthropic.ts

import Anthropic from '@anthropic-ai/sdk'
import type { SessionMessage, ToolDef, ToolCall } from '@quasar/core'
import { ProviderError, createLogger } from '@quasar/core'
import type { CompletionOptions, CompletionResult } from './openai.js'

const log = createLogger('agent:anthropic')

export class AnthropicProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
    log.info('Anthropic provider initialized')
  }

  private buildMessages(messages: SessionMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = []

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (msg.images && msg.images.length > 0) {
          const content: Anthropic.ContentBlockParam[] = []
          if (msg.content) {
            content.push({ type: 'text', text: msg.content })
          }
          for (const img of msg.images) {
            const [prefix, base64] = img.split(',')
            const media_type = prefix?.split(':')[1]?.split(';')[0] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
            if (media_type && base64) {
              content.push({
                type: 'image',
                source: { type: 'base64', media_type, data: base64 }
              })
            }
          }
          result.push({ role: 'user', content: content.length > 0 ? content : msg.content })
        } else {
          result.push({ role: 'user', content: msg.content })
        }
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = []
        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments),
            })
          }
        }
        if (content.length > 0) {
          result.push({ role: 'assistant', content })
        }
      } else if (msg.role === 'tool') {
        result.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId!,
            content: msg.content,
          }],
        })
      }
    }

    return result
  }

  private buildTools(tools: ToolDef[]): Anthropic.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }))
  }

  async complete(opts: CompletionOptions): Promise<CompletionResult> {
    const messages = this.buildMessages(opts.messages)
    const tools = opts.tools.length > 0 ? this.buildTools(opts.tools) : undefined

    try {
      if (opts.stream && opts.onChunk) {
        return await this.streamComplete(messages, tools, opts)
      }

      const response = await this.client.messages.create({
        model: opts.model,
        system: opts.systemPrompt,
        messages,
        ...(tools ? { tools } : {}),
        max_tokens: opts.maxTokens,
        temperature: opts.temperature ?? 0.7,
      })

      let content = ''
      const toolCalls: ToolCall[] = []

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          })
        }
      }

      return {
        content,
        toolCalls,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      }
    } catch (e) {
      throw new ProviderError(`Anthropic API error: ${e instanceof Error ? e.message : String(e)}`, e)
    }
  }

  private async streamComplete(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[] | undefined,
    opts: CompletionOptions
  ): Promise<CompletionResult> {
    const stream = this.client.messages.stream({
      model: opts.model,
      system: opts.systemPrompt,
      messages,
      ...(tools ? { tools } : {}),
      max_tokens: opts.maxTokens,
      temperature: opts.temperature ?? 0.7,
    })

    let content = ''
    const toolCalls: ToolCall[] = []

    stream.on('text', (text) => {
      content += text
      opts.onChunk?.(text)
    })

    const finalMessage = await stream.finalMessage()

    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        })
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        promptTokens: finalMessage.usage.input_tokens,
        completionTokens: finalMessage.usage.output_tokens,
        totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      },
    }
  }
}
