// packages/core/src/types/session.ts
import type { SessionId, UserId, ChatId } from './message.js'

export type MessageRole = 'user' | 'assistant' | 'tool'

export interface SessionMessage {
  role: MessageRole
  content: string
  images?: string[]
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  toolCallId?: string
  timestamp: number
}

export interface Session {
  id: SessionId
  userId: UserId
  chatId: ChatId
  messages: SessionMessage[]
  createdAt: number
  updatedAt: number
  model: string
}
