// tests/cache.test.ts
// Test TTLCache (#21)

import { describe, test, expect, beforeEach } from 'vitest'
import { TTLCache, toolCacheKey } from '../packages/core/src/cache.js'

describe('TTLCache', () => {
  let cache: TTLCache<string>

  beforeEach(() => {
    cache = new TTLCache({ maxSize: 5, defaultTTLMs: 1000 })
  })

  test('set and get', () => {
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  test('returns undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined()
  })

  test('has() returns correct boolean', () => {
    cache.set('exists', 'yes')
    expect(cache.has('exists')).toBe(true)
    expect(cache.has('nope')).toBe(false)
  })

  test('delete removes entry', () => {
    cache.set('del', 'me')
    cache.delete('del')
    expect(cache.get('del')).toBeUndefined()
  })

  test('LRU eviction when maxSize reached', () => {
    for (let i = 0; i < 6; i++) {
      cache.set(`k${i}`, `v${i}`)
    }
    // First key should be evicted (maxSize = 5)
    expect(cache.get('k0')).toBeUndefined()
    expect(cache.get('k5')).toBe('v5')
  })

  test('TTL expiry', async () => {
    cache.set('ttl', 'val', 50) // 50ms TTL
    expect(cache.get('ttl')).toBe('val')
    await new Promise(r => setTimeout(r, 60))
    expect(cache.get('ttl')).toBeUndefined()
  })

  test('getStats returns correct hit/miss counts', () => {
    cache.set('a', '1')
    cache.get('a')  // hit
    cache.get('b')  // miss
    cache.get('a')  // hit

    const stats = cache.getStats()
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe('67%')
    expect(stats.size).toBe(1)
  })

  test('clear resets everything', () => {
    cache.set('x', 'y')
    cache.clear()
    expect(cache.get('x')).toBeUndefined()
    expect(cache.getStats().size).toBe(0)
  })
})

describe('toolCacheKey', () => {
  test('generates key for cacheable tools', () => {
    const key = toolCacheKey('file_read', { path: '/test.txt' })
    expect(key).toBe('file_read:{"path":"/test.txt"}')
  })

  test('returns empty string for non-cacheable tools', () => {
    const key = toolCacheKey('exec', { command: 'ls' })
    expect(key).toBe('')
  })

  test('returns empty for unknown tools', () => {
    expect(toolCacheKey('unknown_tool', {})).toBe('')
  })
})
