// packages/agent/src/context.ts
// Context engineering — summarize, truncate, manage context window

import type { SessionMessage } from '@quasar/core'
import { createLogger } from '@quasar/core'

const log = createLogger('agent:context')

/** Estimate token count (rough: 1 token ≈ 4 chars for English, 2 chars for CJK) */
export function estimateTokens(text: string): number {
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

  const maxChars = maxTokens * 4
  const truncated = output.slice(0, maxChars)
  const remaining = output.length - maxChars
  return `${truncated}\n\n... (${remaining} characters truncated)`
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

  for (let i = messages.length - 1; i >= keepFirst; i--) {
    const msg = messages[i]!
    const msgTokens = estimateTokens(msg.content) + 4
    if (recentTokens + msgTokens > available - estimateMessagesTokens(firstMessages)) break
    recentMessages.unshift(msg)
    recentTokens += msgTokens
  }

  // Add summary of removed messages
  const removedCount = messages.length - keepFirst - recentMessages.length
  if (removedCount > 0) {
    const summary: SessionMessage = {
      role: 'assistant',
      content: `[Context compacted: ${removedCount} earlier messages summarized to save tokens]`,
      timestamp: Date.now(),
    }
    log.info(`Compacted ${removedCount} messages, keeping ${firstMessages.length + recentMessages.length + 1}`)
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
