// tests/providers.test.ts
// Unit tests for provider detection (#16)

import { describe, it, expect } from 'vitest'
import { detectProvider, stripModelPrefix } from '@quasar/agent'

describe('detectProvider', () => {
  it('should detect OpenAI models', () => {
    expect(detectProvider('gpt-4o')).toBe('openai')
    expect(detectProvider('gpt-4o-mini')).toBe('openai')
    expect(detectProvider('o1-preview')).toBe('openai')
    expect(detectProvider('o3-mini')).toBe('openai')
    expect(detectProvider('o4-mini')).toBe('openai')
  })

  it('should detect Anthropic models', () => {
    expect(detectProvider('claude-3-5-sonnet-latest')).toBe('anthropic')
    expect(detectProvider('claude-3-haiku-20240307')).toBe('anthropic')
  })

  it('should detect Google models', () => {
    expect(detectProvider('gemini-2.0-flash')).toBe('google')
    expect(detectProvider('gemini-2.5-pro-preview-05-06')).toBe('google')
  })

  it('should detect OpenRouter prefix', () => {
    expect(detectProvider('openrouter/anthropic/claude-3.5-sonnet')).toBe('openrouter')
    expect(detectProvider('openrouter/deepseek/deepseek-chat')).toBe('openrouter')
  })

  it('should detect Ollama prefix', () => {
    expect(detectProvider('ollama/llama3')).toBe('ollama')
    expect(detectProvider('ollama/mistral')).toBe('ollama')
  })
})

describe('stripModelPrefix', () => {
  it('should strip openrouter/ prefix', () => {
    expect(stripModelPrefix('openrouter/deepseek/deepseek-chat')).toBe('deepseek/deepseek-chat')
  })

  it('should strip ollama/ prefix', () => {
    expect(stripModelPrefix('ollama/llama3')).toBe('llama3')
  })

  it('should not strip non-prefixed models', () => {
    expect(stripModelPrefix('gpt-4o')).toBe('gpt-4o')
    expect(stripModelPrefix('claude-3-5-sonnet-latest')).toBe('claude-3-5-sonnet-latest')
  })
})
