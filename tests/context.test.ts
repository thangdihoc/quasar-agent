// tests/context.test.ts
// Unit tests for context engineering (#16)

import { describe, it, expect } from 'vitest'
import { estimateTokens, truncateToolOutput, compactMessages, buildContextWindow } from '@quasar/agent'
import type { SessionMessage } from '@quasar/core'

describe('estimateTokens', () => {
  it('should estimate tokens for English text', () => {
    const text = 'Hello, how are you doing today?'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(20)
  })

  it('should estimate higher tokens for CJK text', () => {
    const ascii = 'Hello world'
    const cjk = 'こんにちは世界'
    const asciiTokens = estimateTokens(ascii)
    const cjkTokens = estimateTokens(cjk)
    // CJK should have higher token/char ratio
    expect(cjkTokens / cjk.length).toBeGreaterThan(asciiTokens / ascii.length)
  })

  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('truncateToolOutput', () => {
  it('should not truncate short output', () => {
    const output = 'Short output'
    expect(truncateToolOutput(output)).toBe(output)
  })

  it('should truncate very long output', () => {
    const output = 'x'.repeat(50_000)
    const truncated = truncateToolOutput(output, 100)
    expect(truncated.length).toBeLessThan(output.length)
    expect(truncated).toContain('truncated')
  })
})

describe('compactMessages', () => {
  const makeMessages = (count: number): SessionMessage[] =>
    Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Message ${i}: ${'x'.repeat(200)}`,
      timestamp: Date.now() + i,
    }))

  it('should return messages unchanged if within limits', () => {
    const messages = makeMessages(4)
    const result = compactMessages(messages, 100_000, 500)
    expect(result.length).toBe(4)
  })

  it('should compact messages when over limit', () => {
    const messages = makeMessages(100)
    const result = compactMessages(messages, 2000, 500)
    expect(result.length).toBeLessThan(100)
  })

  it('should include summary for removed messages', () => {
    const messages = makeMessages(100)
    const result = compactMessages(messages, 2000, 500)
    const summary = result.find(m => m.content.includes('Context compacted'))
    expect(summary).toBeDefined()
  })
})

describe('buildContextWindow', () => {
  it('should truncate long tool outputs', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'Hello', timestamp: Date.now() },
      { role: 'tool', content: 'x'.repeat(50_000), toolCallId: '1', timestamp: Date.now() },
    ]
    const result = buildContextWindow(messages, 100_000, 500)
    const toolMsg = result.find(m => m.role === 'tool')
    expect(toolMsg!.content.length).toBeLessThan(50_000)
  })
})
