// packages/agent/src/providers/google.ts

import { GoogleGenerativeAI, type Content, type Tool, type Part, type FunctionDeclaration, SchemaType } from '@google/generative-ai'
import type { SessionMessage, ToolDef, ToolCall } from '@quasar/core'
import { ProviderError, createLogger } from '@quasar/core'
import type { CompletionOptions, CompletionResult } from './openai.js'

const log = createLogger('agent:google')

export class GoogleProvider {
  private genAI: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey)
    log.info('Google provider initialized')
  }

  private buildContents(messages: SessionMessage[]): Content[] {
    const result: Content[] = []

    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ role: 'user', parts: [{ text: msg.content }] })
      } else if (msg.role === 'assistant') {
        const parts: Part[] = []
        if (msg.content) parts.push({ text: msg.content })
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: { name: tc.name, args: JSON.parse(tc.arguments) }
            })
          }
        }
        if (parts.length > 0) result.push({ role: 'model', parts })
      } else if (msg.role === 'tool') {
        result.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: 'tool_result',
              response: { result: msg.content }
            }
          }]
        })
      }
    }

    return result
  }

  private buildTools(tools: ToolDef[]): Tool[] {
    const functionDeclarations = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: ((t.parameters as Record<string, unknown>).properties || {}) as Record<string, unknown>,
        required: ((t.parameters as Record<string, unknown>).required as string[]) || [],
      },
    })) as FunctionDeclaration[]
    return [{ functionDeclarations }]
  }

  async complete(opts: CompletionOptions): Promise<CompletionResult> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: opts.model,
        systemInstruction: opts.systemPrompt,
        ...(opts.tools.length > 0 ? { tools: this.buildTools(opts.tools) } : {}),
      })

      const contents = this.buildContents(opts.messages)

      if (opts.stream && opts.onChunk) {
        const result = await model.generateContentStream({ contents })
        let content = ''
        const toolCalls: ToolCall[] = []

        for await (const chunk of result.stream) {
          const text = chunk.text()
          if (text) {
            content += text
            opts.onChunk(text)
          }
          const calls = chunk.functionCalls()
          if (calls) {
            for (const call of calls) {
              toolCalls.push({
                id: `google_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: call.name,
                arguments: (call.args || {}) as Record<string, unknown>,
              })
            }
          }
        }

        return { content, toolCalls }
      }

      const result = await model.generateContent({ contents })
      const response = result.response
      let content = response.text() || ''
      const toolCalls: ToolCall[] = []

      const calls = response.functionCalls()
      if (calls) {
        for (const call of calls) {
          toolCalls.push({
            id: `google_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: call.name,
            arguments: (call.args || {}) as Record<string, unknown>,
          })
        }
      }

      const usage = response.usageMetadata
      return {
        content,
        toolCalls,
        usage: usage ? {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount || 0,
        } : undefined,
      }
    } catch (e) {
      throw new ProviderError(`Google API error: ${e instanceof Error ? e.message : String(e)}`, e)
    }
  }
}
