// packages/core/src/events.ts
// Simple event bus — built on Node.js EventEmitter

import { EventEmitter } from 'events'

export type QuasarEvent =
  | { type: 'agent:start'; sessionId: string; model: string }
  | { type: 'agent:response'; sessionId: string; content: string; rounds: number }
  | { type: 'agent:error'; sessionId: string; error: string }
  | { type: 'tool:call'; sessionId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool:result'; sessionId: string; tool: string; result: string; durationMs: number; isError: boolean }
  | { type: 'model:switch'; from: string; to: string }
  | { type: 'session:create'; sessionId: string; userId: number }
  | { type: 'session:resume'; sessionId: string; messageCount: number }
  | { type: 'approval:request'; id: string; command: string }
  | { type: 'approval:response'; id: string; approved: boolean }
  | { type: 'token:usage'; sessionId: string; promptTokens: number; completionTokens: number; totalTokens: number; model: string }
  | { type: 'circuit:state'; provider: string; state: string }
  | { type: 'browser:update'; url: string; title: string; screenshot: string; elements: Array<{ refId: string; tag: string; text: string; type?: string; placeholder?: string }> }
  | { type: 'heartbeat:tick'; timestamp: number }
  | { type: 'heartbeat:result'; message: string; checks: string[] }
  | { type: 'heartbeat:skip'; reason: 'quiet_hours' | 'no_checklist' | 'disabled' }

class QuasarEventBus extends EventEmitter {
  emit(event: QuasarEvent['type'], data: QuasarEvent): boolean {
    return super.emit(event, data)
  }

  on(event: QuasarEvent['type'], listener: (data: QuasarEvent) => void): this {
    return super.on(event, listener)
  }

  off(event: QuasarEvent['type'], listener: (data: QuasarEvent) => void): this {
    return super.off(event, listener)
  }
}

// Singleton — toàn bộ hệ thống dùng chung 1 bus
export const eventBus = new QuasarEventBus()
