// packages/memory/src/sqlite.ts

import Database from 'better-sqlite3'
import type { Session, SessionMessage, SessionId } from '@quasar/core'
import { MemoryError, createLogger } from '@quasar/core'
import { randomUUID } from 'crypto'

const log = createLogger('memory:sqlite')

export interface TokenUsageRow {
  sessionId: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  timestamp: number
}

export interface SessionSummary {
  id: string
  title: string
  model: string
  messageCount: number
  totalTokens: number
  createdAt: number
  updatedAt: number
  preview: string
}

export class SqliteMemory {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('temp_store = MEMORY')
    this.db.pragma('cache_size = -2000')
    this.init()
    log.info(`SQLite initialized at ${dbPath} with WAL and performance pragmas`)
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        model TEXT NOT NULL DEFAULT 'gpt-4o',
        title TEXT DEFAULT NULL,
        forked_from TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        images TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        user_id INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, window_start)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
    `)

    // Migration cho tính năng #19 Vision
    try {
      this.db.exec('ALTER TABLE messages ADD COLUMN images TEXT;')
    } catch { /* column may already exist */ }
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
        'INSERT INTO messages (session_id, role, content, images, tool_calls, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        sessionId,
        msg.role,
        msg.content || '',
        msg.images ? JSON.stringify(msg.images) : null,
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
      'SELECT role, content, images, tool_calls, tool_call_id, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as Array<{
      role: string; content: string; images: string | null; tool_calls: string | null;
      tool_call_id: string | null; timestamp: number
    }>

    return rows.map(r => ({
      role: r.role as SessionMessage['role'],
      content: r.content,
      images: r.images ? JSON.parse(r.images) : undefined,
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

  // --- Token Usage Tracking (#5) ---

  addTokenUsage(sessionId: SessionId, model: string, promptTokens: number, completionTokens: number, totalTokens: number): void {
    try {
      this.db.prepare(
        'INSERT INTO token_usage (session_id, model, prompt_tokens, completion_tokens, total_tokens, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(sessionId, model, promptTokens, completionTokens, totalTokens, Date.now())
    } catch (e) {
      log.error('Failed to save token usage:', e)
    }
  }

  getTokenUsage(sessionId: SessionId): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(prompt_tokens),0) as p, COALESCE(SUM(completion_tokens),0) as c, COALESCE(SUM(total_tokens),0) as t FROM token_usage WHERE session_id = ?'
    ).get(sessionId) as { p: number; c: number; t: number }
    return { promptTokens: row.p, completionTokens: row.c, totalTokens: row.t }
  }

  getTotalTokenUsage(userId: number): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(tu.prompt_tokens),0) as p, COALESCE(SUM(tu.completion_tokens),0) as c, COALESCE(SUM(tu.total_tokens),0) as t
       FROM token_usage tu JOIN sessions s ON tu.session_id = s.id WHERE s.user_id = ?`
    ).get(userId) as { p: number; c: number; t: number }
    return { promptTokens: row.p, completionTokens: row.c, totalTokens: row.t }
  }

  getTokenUsageByModel(userId: number): Array<{ model: string; totalTokens: number }> {
    return this.db.prepare(
      `SELECT tu.model, SUM(tu.total_tokens) as totalTokens
       FROM token_usage tu JOIN sessions s ON tu.session_id = s.id
       WHERE s.user_id = ? GROUP BY tu.model ORDER BY totalTokens DESC`
    ).all(userId) as Array<{ model: string; totalTokens: number }>
  }

  // --- History Management (#7) ---

  listSessions(userId: number, limit = 20): SessionSummary[] {
    const rows = this.db.prepare(
      `SELECT s.id, s.model, s.title, s.created_at, s.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count,
              COALESCE((SELECT SUM(tu.total_tokens) FROM token_usage tu WHERE tu.session_id = s.id), 0) as total_tokens,
              (SELECT m.content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id ASC LIMIT 1) as preview
       FROM sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC LIMIT ?`
    ).all(userId, limit) as Array<{
      id: string; model: string; title: string | null; created_at: number; updated_at: number;
      message_count: number; total_tokens: number; preview: string | null
    }>

    return rows.map(r => ({
      id: r.id,
      title: r.title || r.preview?.slice(0, 40) || '(empty)',
      model: r.model,
      messageCount: r.message_count,
      totalTokens: r.total_tokens,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      preview: r.preview?.slice(0, 80) || '(empty)',
    }))
  }

  exportSession(sessionId: SessionId): { session: Session; tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } } | null {
    const row = this.db.prepare(
      'SELECT id, user_id, chat_id, model, created_at, updated_at FROM sessions WHERE id = ?'
    ).get(sessionId) as { id: string; user_id: number; chat_id: number; model: string; created_at: number; updated_at: number } | undefined

    if (!row) return null

    const messages = this.getMessages(row.id)
    const tokenUsage = this.getTokenUsage(row.id)

    return {
      session: {
        id: row.id,
        userId: row.user_id,
        chatId: row.chat_id,
        messages,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        model: row.model,
      },
      tokenUsage,
    }
  }

  cleanupOldSessions(userId: number, keepDays = 30): number {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
    const result = this.db.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND updated_at < ?'
    ).run(userId, cutoff)
    const deleted = result.changes
    if (deleted > 0) log.info(`Cleaned up ${deleted} old sessions for user ${userId}`)
    return deleted
  }

  // --- Session Title (#23) ---

  updateSessionTitle(sessionId: SessionId, title: string): void {
    this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId)
  }

  getSessionTitle(sessionId: SessionId): string | null {
    const row = this.db.prepare('SELECT title FROM sessions WHERE id = ?').get(sessionId) as { title: string | null } | undefined
    return row?.title || null
  }

  // --- Fork Session (#20) ---

  forkSession(sessionId: SessionId, userId: number, chatId: number): Session | null {
    const original = this.exportSession(sessionId)
    if (!original) return null

    const newId = randomUUID()
    const now = Date.now()
    const model = original.session.model

    try {
      this.db.prepare(
        'INSERT INTO sessions (id, user_id, chat_id, model, title, forked_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(newId, userId, chatId, model, `Fork of ${original.session.id.slice(0, 8)}`, sessionId, now, now)

      // Copy all messages
      const insertMsg = this.db.prepare(
        'INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      )

      const copyTx = this.db.transaction(() => {
        for (const msg of original.session.messages) {
          insertMsg.run(
            newId, msg.role, msg.content,
            msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
            msg.toolCallId || null, msg.timestamp
          )
        }
      })
      copyTx()

      log.info(`Session forked: ${sessionId} → ${newId}`)
      return {
        id: newId, userId, chatId,
        messages: original.session.messages,
        createdAt: now, updatedAt: now, model,
      }
    } catch (e) {
      throw new MemoryError('Failed to fork session', e)
    }
  }

  // --- Rate Limiting (#24) ---

  checkRateLimit(userId: number, maxRequestsPerMinute = 20, maxTokensPerDay = 500_000): { allowed: boolean; reason?: string } {
    const now = Date.now()
    const minuteWindow = Math.floor(now / 60_000)
    const dayWindow = Math.floor(now / (24 * 60 * 60 * 1000))

    // Check per-minute request rate
    const minuteRow = this.db.prepare(
      'SELECT request_count FROM rate_limits WHERE user_id = ? AND window_start = ?'
    ).get(userId, minuteWindow) as { request_count: number } | undefined

    if (minuteRow && minuteRow.request_count >= maxRequestsPerMinute) {
      return { allowed: false, reason: `Rate limit: ${maxRequestsPerMinute} requests/phút đã hết. Đợi 1 phút.` }
    }

    // Check per-day token budget
    const dayRow = this.db.prepare(
      'SELECT token_count FROM rate_limits WHERE user_id = ? AND window_start = ?'
    ).get(userId, dayWindow) as { token_count: number } | undefined

    if (dayRow && dayRow.token_count >= maxTokensPerDay) {
      return { allowed: false, reason: `Token budget: ${maxTokensPerDay.toLocaleString()} tokens/ngày đã hết.` }
    }

    // Increment request count
    this.db.prepare(
      `INSERT INTO rate_limits (user_id, window_start, request_count, token_count)
       VALUES (?, ?, 1, 0)
       ON CONFLICT(user_id, window_start) DO UPDATE SET request_count = request_count + 1`
    ).run(userId, minuteWindow)

    return { allowed: true }
  }

  addTokensToRateLimit(userId: number, tokens: number): void {
    const dayWindow = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
    this.db.prepare(
      `INSERT INTO rate_limits (user_id, window_start, request_count, token_count)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(user_id, window_start) DO UPDATE SET token_count = token_count + ?`
    ).run(userId, dayWindow, tokens, tokens)
  }

  getRateLimitStatus(userId: number): { requestsThisMinute: number; tokensToday: number } {
    const minuteWindow = Math.floor(Date.now() / 60_000)
    const dayWindow = Math.floor(Date.now() / (24 * 60 * 60 * 1000))

    const minuteRow = this.db.prepare(
      'SELECT COALESCE(request_count, 0) as c FROM rate_limits WHERE user_id = ? AND window_start = ?'
    ).get(userId, minuteWindow) as { c: number } | undefined

    const dayRow = this.db.prepare(
      'SELECT COALESCE(token_count, 0) as c FROM rate_limits WHERE user_id = ? AND window_start = ?'
    ).get(userId, dayWindow) as { c: number } | undefined

    return {
      requestsThisMinute: minuteRow?.c || 0,
      tokensToday: dayRow?.c || 0,
    }
  }

  close(): void {
    this.db.close()
    log.info('SQLite closed')
  }
}
