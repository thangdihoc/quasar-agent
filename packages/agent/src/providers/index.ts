// packages/agent/src/providers/index.ts
// Factory: chọn đúng provider dựa vào config + retry + circuit breaker

import type { QuasarConfig, ProviderName } from '@quasar/core'
import { ConfigError, createLogger, withRetry, CircuitBreaker } from '@quasar/core'
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

/** Wraps a provider with retry + circuit breaker (#4, #17) */
class ResilientProvider implements IProvider {
  private circuitBreaker: CircuitBreaker

  constructor(
    private inner: IProvider,
    private providerName: string,
  ) {
    this.circuitBreaker = new CircuitBreaker(providerName, {
      failureThreshold: 5,
      resetTimeoutMs: 60_000,
    })
  }

  async complete(opts: CompletionOptions): Promise<CompletionResult> {
    return this.circuitBreaker.execute(() =>
      withRetry(() => this.inner.complete(opts), {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30_000,
      })
    )
  }
}

export function createProvider(provider: ProviderName, config: QuasarConfig): IProvider {
  const providerConfig = config.providers[provider]
  let inner: IProvider

  switch (provider) {
    case 'openai': {
      const apiKey = providerConfig?.apiKey || process.env.OPENAI_API_KEY
      if (!apiKey) throw new ConfigError('OPENAI_API_KEY not configured')
      inner = new OpenAIProvider(apiKey, providerConfig?.baseUrl)
      break
    }

    case 'anthropic': {
      const apiKey = providerConfig?.apiKey || process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new ConfigError('ANTHROPIC_API_KEY not configured')
      inner = new AnthropicProvider(apiKey)
      break
    }

    case 'google': {
      const apiKey = providerConfig?.apiKey || process.env.GOOGLE_API_KEY
      if (!apiKey) throw new ConfigError('GOOGLE_API_KEY not configured')
      inner = new GoogleProvider(apiKey)
      break
    }

    case 'openrouter': {
      const apiKey = providerConfig?.apiKey || process.env.OPENROUTER_API_KEY
      if (!apiKey) throw new ConfigError('OPENROUTER_API_KEY not configured')
      const baseUrl = providerConfig?.baseUrl || 'https://openrouter.ai/api/v1'
      inner = new OpenAIProvider(apiKey, baseUrl)
      break
    }

    case 'ollama': {
      const baseUrl = providerConfig?.baseUrl || 'http://localhost:11434/v1'
      // Ollama không cần API key
      inner = new OpenAIProvider('ollama', baseUrl)
      break
    }

    default:
      throw new ConfigError(`Unknown provider: ${provider}`)
  }

  // Wrap with retry + circuit breaker (skip for local Ollama)
  if (provider === 'ollama') return inner
  return new ResilientProvider(inner, provider)
}
