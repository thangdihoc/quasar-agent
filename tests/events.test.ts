// tests/events.test.ts
// Test EventBus typed off() (#25)

import { describe, test, expect, vi } from 'vitest'
import { eventBus } from '../packages/core/src/events.js'

describe('EventBus', () => {
  test('on/emit works', () => {
    const fn = vi.fn()
    eventBus.on('agent:start', fn)
    eventBus.emit('agent:start', { type: 'agent:start', sessionId: 'test', model: 'gpt-4' })
    expect(fn).toHaveBeenCalledOnce()
    eventBus.off('agent:start', fn)
  })

  test('off removes listener', () => {
    const fn = vi.fn()
    eventBus.on('tool:call', fn)
    eventBus.off('tool:call', fn)
    eventBus.emit('tool:call', { type: 'tool:call', sessionId: 'test', tool: 'exec', args: {} })
    expect(fn).not.toHaveBeenCalled()
  })

  test('multiple listeners on same event', () => {
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    eventBus.on('agent:error', fn1)
    eventBus.on('agent:error', fn2)
    eventBus.emit('agent:error', { type: 'agent:error', sessionId: 'x', error: 'test' })
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
    eventBus.off('agent:error', fn1)
    eventBus.off('agent:error', fn2)
  })
})
