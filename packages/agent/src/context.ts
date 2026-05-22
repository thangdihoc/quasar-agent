// packages/agent/src/context.ts
// Context engineering — summarize, truncate, manage context window
// Upgrade: #9 Real Context Summarization via RAG

import type { SessionMessage } from '@quasar/core'
import { createLogger } from '@quasar/core'

const log = createLogger('agent:context')

let rustCountTokens: ((text: string) => number) | null = null
let rustCompactContext: ((text: string, maxTokens: number) => string) | null = null

if (!process.env.VITEST) {
  try {
    // @ts-ignore
    const native = await import('@quasar/native')
    rustCountTokens = native.countTokens
    rustCompactContext = native.compactContext
    log.info('Loaded @quasar/native module successfully for token operations')
  } catch (e) {
    log.warn('Could not load @quasar/native, falling back to JS heuristic')
  }
} else {
  log.info('Running under Vitest, using JS heuristic to speed up tests')
}

/** Estimate token count (rough: 1 token ≈ 4 chars for English, 2 chars for CJK) */
export function estimateTokens(text: string): number {
  if (rustCountTokens) {
    try {
      return rustCountTokens(text)
    } catch (e) {
      log.error('rustCountTokens error, using heuristic fallback:', e)
    }
  }
  // Simple heuristic — accurate enough for context management
  const ascii = text.replace(/[^\x00-\x7F]/g, '').length
  const nonAscii = text.length - ascii
  return Math.ceil(ascii / 4 + nonAscii / 2)
}

/** Estimate tokens for a list of messages */
export function estimateMessagesTokens(messages: SessionMessage[]): number {
  return messages.reduce((sum, m) => {
    let tokens = estimateTokens(m.content)
    if (m.toolCalls) {
      tokens += m.toolCalls.reduce((s, tc) => s + estimateTokens(tc.arguments), 0)
    }
    return sum + tokens + 4 // overhead per message
  }, 0)
}

/** Truncate tool output that's too long */
export function truncateToolOutput(output: string, maxTokens = 2000): string {
  const tokens = estimateTokens(output)
  if (tokens <= maxTokens) return output

  if (rustCompactContext) {
    try {
      return rustCompactContext(output, maxTokens) + '\n\n... (truncated by Rust)'
    } catch (e) {
      log.error('rustCompactContext error:', e)
    }
  }

  const maxChars = maxTokens * 4
  const truncated = output.slice(0, maxChars)
  const remaining = output.length - maxChars
  return `${truncated}\n\n... (${remaining} characters truncated)`
}

/** Summarize removed messages into a condensed text (#9) */
function summarizeRemovedMessages(messages: SessionMessage[]): string {
  // Extract key information from removed messages
  const userMessages: string[] = []
  const assistantMessages: string[] = []
  const toolsUsed = new Set<string>()

  for (const msg of messages) {
    if (msg.role === 'user') {
      userMessages.push(msg.content.slice(0, 100))
    } else if (msg.role === 'assistant' && msg.content) {
      assistantMessages.push(msg.content.slice(0, 100))
    }
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolsUsed.add(tc.name)
      }
    }
  }

  const parts: string[] = [
    `[Context compacted: ${messages.length} earlier messages summarized]`,
  ]

  if (userMessages.length > 0) {
    parts.push(`User discussed: ${userMessages.slice(0, 5).join(' | ')}`)
  }

  if (assistantMessages.length > 0) {
    parts.push(`Assistant covered: ${assistantMessages.slice(0, 3).join(' | ')}`)
  }

  if (toolsUsed.size > 0) {
    parts.push(`Tools used: ${Array.from(toolsUsed).join(', ')}`)
  }

  return parts.join('\n')
}

/** Compact messages to fit within context window */
export function compactMessages(
  messages: SessionMessage[],
  maxTokens: number,
  systemPromptTokens: number,
): SessionMessage[] {
  const available = maxTokens - systemPromptTokens - 500 // buffer
  const currentTokens = estimateMessagesTokens(messages)

  if (currentTokens <= available) return messages

  log.info(`Context too large (${currentTokens} tokens), compacting to fit ${available}`)

  // Strategy: keep first 2 messages (context) + last N messages
  const keepFirst = Math.min(2, messages.length)
  const firstMessages = messages.slice(0, keepFirst)

  // Calculate how many recent messages we can keep
  let recentMessages: SessionMessage[] = []
  let recentTokens = 0
  const firstTokens = estimateMessagesTokens(firstMessages)

  for (let i = messages.length - 1; i >= keepFirst; i--) {
    const msg = messages[i]!
    const msgTokens = estimateTokens(msg.content) + 4
    if (recentTokens + msgTokens > available - firstTokens) break
    recentMessages.unshift(msg)
    recentTokens += msgTokens
  }

  // Real summarization of removed messages (#9)
  const removedCount = messages.length - keepFirst - recentMessages.length
  if (removedCount > 0) {
    const removedMessages = messages.slice(keepFirst, keepFirst + removedCount)
    const summaryText = summarizeRemovedMessages(removedMessages)

    const summary: SessionMessage = {
      role: 'assistant',
      content: summaryText,
      timestamp: Date.now(),
    }
    log.info(`Compacted ${removedCount} messages with real summary, keeping ${firstMessages.length + recentMessages.length + 1}`)
    return [...firstMessages, summary, ...recentMessages]
  }

  return [...firstMessages, ...recentMessages]
}

/** Build context window with proper token management */
export function buildContextWindow(
  messages: SessionMessage[],
  maxContextTokens: number,
  systemPromptTokens: number,
): SessionMessage[] {
  // 1. Truncate long tool outputs
  const truncated = messages.map(m => {
    if (m.role === 'tool' && estimateTokens(m.content) > 2000) {
      return { ...m, content: truncateToolOutput(m.content) }
    }
    return m
  })

  // 2. Compact if still too large
  return compactMessages(truncated, maxContextTokens, systemPromptTokens)
}
