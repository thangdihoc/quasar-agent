// packages/core/src/retry.ts
// Retry with exponential backoff + Circuit breaker

import { createLogger } from './logger.js'

const log = createLogger('core:retry')

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  retryOn?: (error: unknown) => boolean
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryOn: (error: unknown) => {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase()
      // Retry on rate limit, timeout, server errors
      return msg.includes('rate') || msg.includes('429') ||
             msg.includes('timeout') || msg.includes('500') ||
             msg.includes('502') || msg.includes('503') ||
             msg.includes('overloaded')
    }
    return false
  },
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, retryOn } = { ...DEFAULT_RETRY, ...opts }

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= maxRetries || !retryOn(error)) {
        throw error
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs)
      log.warn(`Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${error instanceof Error ? error.message : error}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

// --- Circuit Breaker ---

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  failureThreshold?: number
  resetTimeoutMs?: number
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private lastFailureTime = 0
  private failureThreshold: number
  private resetTimeoutMs: number

  constructor(private name: string, opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 60_000
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half-open'
        log.info(`Circuit ${this.name}: half-open, trying one request`)
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN. Try again later.`)
      }
    }

    try {
      const result = await fn()
      if (this.state === 'half-open') {
        this.state = 'closed'
        this.failureCount = 0
        log.info(`Circuit ${this.name}: closed (recovered)`)
      }
      return result
    } catch (error) {
      this.failureCount++
      this.lastFailureTime = Date.now()
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open'
        log.error(`Circuit ${this.name}: OPEN after ${this.failureCount} failures`)
      }
      throw error
    }
  }

  getState(): CircuitState { return this.state }
  reset(): void { this.state = 'closed'; this.failureCount = 0 }
}
