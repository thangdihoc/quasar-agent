// packages/core/src/cache.ts
// Tool output caching (#21) — LRU cache with TTL

import { createLogger } from './logger.js'

const log = createLogger('core:cache')

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class TTLCache<T = string> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize: number
  private defaultTTL: number
  private hits = 0
  private misses = 0

  constructor(opts: { maxSize?: number; defaultTTLMs?: number } = {}) {
    this.maxSize = opts.maxSize ?? 200
    this.defaultTTL = opts.defaultTTLMs ?? 5 * 60 * 1000 // 5 min default
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.misses++
      return undefined
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }
    this.hits++
    return entry.value
  }

  set(key: string, value: T, ttlMs?: number): void {
    // LRU eviction
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) this.cache.delete(oldestKey)
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTTL),
    })
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  getStats(): { size: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${Math.round(this.hits / total * 100)}%` : 'N/A',
    }
  }
}

/** Shared tool output cache — used by agent loop */
export const toolCache = new TTLCache<string>({
  maxSize: 200,
  defaultTTLMs: 5 * 60 * 1000,
})

/** Generate cache key from tool name + args */
export function toolCacheKey(name: string, args: Record<string, unknown>): string {
  // Only cache deterministic tools
  const CACHEABLE_TOOLS = ['file_read', 'file_list', 'web_fetch', 'pdf_read', 'search_memories', 'get_plan']
  if (!CACHEABLE_TOOLS.includes(name)) return ''
  return `${name}:${JSON.stringify(args)}`
}
