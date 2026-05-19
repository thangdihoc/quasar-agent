// packages/core/src/types/message.ts

export type UserId = number
export type ChatId = number
export type MessageId = number
export type SessionId = string

export interface IncomingMessage {
  id: MessageId
  chatId: ChatId
  userId: UserId
  text?: string
  voice?: Buffer
  photo?: Buffer
  document?: { data: Buffer; mimeType: string; fileName: string }
  timestamp: number
}

export interface OutgoingMessage {
  chatId: ChatId
  text?: string
  voice?: string  // file path
  photo?: string  // file path
  document?: string // file path
  replyTo?: MessageId
}
