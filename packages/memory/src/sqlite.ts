// packages/memory/src/sqlite.ts

import Database from 'better-sqlite3'
import type { Session, SessionMessage, SessionId } from '@quasar/core'
import { MemoryError, createLogger } from '@quasar/core'
import { randomUUID } from 'crypto'

const log = createLogger('memory:sqlite')

export class SqliteMemory {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.init()
    log.info(`SQLite initialized at ${dbPath}`)
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        model TEXT NOT NULL DEFAULT 'gpt-4o',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `)
  }

  createSession(userId: number, chatId: number, model: string): Session {
    const id = randomUUID()
    const now = Date.now()
    try {
      this.db.prepare(
        'INSERT INTO sessions (id, user_id, chat_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, userId, chatId, model, now, now)
      log.info(`Session created: ${id}`)
      return { id, userId, chatId, messages: [], createdAt: now, updatedAt: now, model }
    } catch (e) {
      throw new MemoryError('Failed to create session', e)
    }
  }

  addMessage(sessionId: SessionId, msg: SessionMessage): void {
    try {
      this.db.prepare(
        'INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        sessionId,
        msg.role,
        msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolCallId || null,
        msg.timestamp
      )
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId)
    } catch (e) {
      throw new MemoryError('Failed to add message', e)
    }
  }

  getMessages(sessionId: SessionId): SessionMessage[] {
    const rows = this.db.prepare(
      'SELECT role, content, tool_calls, tool_call_id, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as Array<{
      role: string; content: string; tool_calls: string | null;
      tool_call_id: string | null; timestamp: number
    }>

    return rows.map(r => ({
      role: r.role as SessionMessage['role'],
      content: r.content,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      toolCallId: r.tool_call_id || undefined,
      timestamp: r.timestamp,
    }))
  }

  getLatestSession(userId: number, chatId: number): Session | null {
    const row = this.db.prepare(
      'SELECT id, user_id, chat_id, model, created_at, updated_at FROM sessions WHERE user_id = ? AND chat_id = ? ORDER BY updated_at DESC LIMIT 1'
    ).get(userId, chatId) as { id: string; user_id: number; chat_id: number; model: string; created_at: number; updated_at: number } | undefined

    if (!row) return null

    const messages = this.getMessages(row.id)
    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      messages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      model: row.model,
    }
  }

  updateModel(sessionId: SessionId, model: string): void {
    this.db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, sessionId)
  }

  deleteSession(sessionId: SessionId): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    log.info(`Session deleted: ${sessionId}`)
  }

  getSessionCount(userId: number): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE user_id = ?'
    ).get(userId) as { count: number }
    return row.count
  }

  close(): void {
    this.db.close()
    log.info('SQLite closed')
  }
}
