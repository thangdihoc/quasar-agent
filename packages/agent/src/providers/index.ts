// packages/agent/src/providers/index.ts
// Factory: chọn đúng provider dựa vào config

import type { QuasarConfig, ProviderName } from '@quasar/core'
import { ConfigError, createLogger } from '@quasar/core'
import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'
import { GoogleProvider } from './google.js'
import type { CompletionOptions, CompletionResult } from './openai.js'

const log = createLogger('agent:providers')

export interface IProvider {
  complete(opts: CompletionOptions): Promise<CompletionResult>
}

/** Detect provider from model name */
export function detectProvider(model: string): ProviderName {
  if (model.startsWith('openrouter/')) return 'openrouter'
  if (model.startsWith('ollama/')) return 'ollama'
  if (model.includes('claude')) return 'anthropic'
  if (model.includes('gemini')) return 'google'
  if (model.includes('gpt') || model.includes('o1') || model.includes('o3') || model.includes('o4')) return 'openai'
  // Default
  return 'openai'
}

/** Strip provider prefix from model name */
export function stripModelPrefix(model: string): string {
  if (model.startsWith('openrouter/')) return model.slice('openrouter/'.length)
  if (model.startsWith('ollama/')) return model.slice('ollama/'.length)
  return model
}

export function createProvider(provider: ProviderName, config: QuasarConfig): IProvider {
  const providerConfig = config.providers[provider]

  switch (provider) {
    case 'openai': {
      const apiKey = providerConfig?.apiKey || process.env.OPENAI_API_KEY
      if (!apiKey) throw new ConfigError('OPENAI_API_KEY not configured')
      return new OpenAIProvider(apiKey, providerConfig?.baseUrl)
    }

    case 'anthropic': {
      const apiKey = providerConfig?.apiKey || process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new ConfigError('ANTHROPIC_API_KEY not configured')
      return new AnthropicProvider(apiKey)
    }

    case 'google': {
      const apiKey = providerConfig?.apiKey || process.env.GOOGLE_API_KEY
      if (!apiKey) throw new ConfigError('GOOGLE_API_KEY not configured')
      return new GoogleProvider(apiKey)
    }

    case 'openrouter': {
      const apiKey = providerConfig?.apiKey || process.env.OPENROUTER_API_KEY
      if (!apiKey) throw new ConfigError('OPENROUTER_API_KEY not configured')
      const baseUrl = providerConfig?.baseUrl || 'https://openrouter.ai/api/v1'
      return new OpenAIProvider(apiKey, baseUrl)
    }

    case 'ollama': {
      const baseUrl = providerConfig?.baseUrl || 'http://localhost:11434/v1'
      // Ollama không cần API key
      return new OpenAIProvider('ollama', baseUrl)
    }

    default:
      throw new ConfigError(`Unknown provider: ${provider}`)
  }
}
