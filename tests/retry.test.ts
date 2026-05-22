// tests/retry.test.ts
// Unit tests for retry + circuit breaker (#16)

import { describe, it, expect, vi } from 'vitest'
import { withRetry, CircuitBreaker } from '@quasar/core'

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { maxRetries: 3 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should retry on retryable error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('should throw on non-retryable error immediately', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid_api_key'))
    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('invalid_api_key')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should throw after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('429 rate limit'))
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow('rate limit')
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })
})

describe('CircuitBreaker', () => {
  it('should pass through when closed', async () => {
    const cb = new CircuitBreaker('test')
    const result = await cb.execute(async () => 'ok')
    expect(result).toBe('ok')
    expect(cb.getState()).toBe('closed')
  })

  it('should open after failure threshold', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2, resetTimeoutMs: 1000 })
    const failingFn = async () => { throw new Error('fail') }

    // Fail twice to trigger open
    await expect(cb.execute(failingFn)).rejects.toThrow()
    await expect(cb.execute(failingFn)).rejects.toThrow()

    expect(cb.getState()).toBe('open')

    // Should reject immediately when open
    await expect(cb.execute(async () => 'ok')).rejects.toThrow('Circuit breaker')
  })

  it('should reset properly', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1 })
    await expect(cb.execute(async () => { throw new Error('fail') })).rejects.toThrow()
    expect(cb.getState()).toBe('open')

    cb.reset()
    expect(cb.getState()).toBe('closed')

    const result = await cb.execute(async () => 'recovered')
    expect(result).toBe('recovered')
  })
})
