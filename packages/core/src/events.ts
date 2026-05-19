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

class QuasarEventBus extends EventEmitter {
  emit(event: QuasarEvent['type'], data: QuasarEvent): boolean {
    return super.emit(event, data)
  }

  on(event: QuasarEvent['type'], listener: (data: QuasarEvent) => void): this {
    return super.on(event, listener)
  }
}

// Singleton — toàn bộ hệ thống dùng chung 1 bus
export const eventBus = new QuasarEventBus()
