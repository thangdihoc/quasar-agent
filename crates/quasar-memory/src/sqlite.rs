use quasar_core::{Message, Session, SessionId, QuasarResult, QuasarError};
use rusqlite::{Connection, params};
use std::path::Path;

pub struct SqliteMemory {
    conn: Connection,
}

impl SqliteMemory {
    pub fn new(path: impl AsRef<Path>) -> QuasarResult<Self> {
        let conn = Connection::open(path.as_ref())
            .map_err(|e| QuasarError::database(format!("Failed to open database: {}", e)))?;

        // Set pragmas
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA temp_store = MEMORY;
             PRAGMA cache_size = -2000;"
        ).map_err(|e| QuasarError::database(format!("Failed to set pragmas: {}", e)))?;

        let mut memory = Self { conn };
        memory.init()?;
        Ok(memory)
    }

    fn init(&mut self) -> QuasarResult<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
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

            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);"
        ).map_err(|e| QuasarError::database(format!("Failed to create tables: {}", e)))?;

        Ok(())
    }

    pub fn create_session(&mut self, session: &Session) -> QuasarResult<()> {
        self.conn.execute(
            "INSERT INTO sessions (id, user_id, chat_id, model, title, forked_from, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session.id,
                session.user_id,
                session.chat_id,
                session.model,
                session.title,
                session.forked_from,
                session.created_at,
                session.updated_at,
            ],
        ).map_err(|e| QuasarError::database(format!("Failed to create session: {}", e)))?;

        Ok(())
    }

    pub fn get_messages(&self, session_id: &SessionId) -> QuasarResult<Vec<Message>> {
        let mut stmt = self.conn.prepare(
            "SELECT role, content, images, tool_calls, tool_call_id, timestamp
             FROM messages
             WHERE session_id = ?1
             ORDER BY id ASC"
        ).map_err(|e| QuasarError::database(format!("Failed to prepare statement: {}", e)))?;

        let messages = stmt.query_map(params![session_id], |row| {
            let role_str: String = row.get(0)?;
            let role = match role_str.as_str() {
                "user" => quasar_core::MessageRole::User,
                "assistant" => quasar_core::MessageRole::Assistant,
                "system" => quasar_core::MessageRole::System,
                "tool" => quasar_core::MessageRole::Tool,
                _ => quasar_core::MessageRole::User,
            };

            let images_json: Option<String> = row.get(2)?;
            let images = images_json.and_then(|s| serde_json::from_str(&s).ok());

            let tool_calls_json: Option<String> = row.get(3)?;
            let tool_calls = tool_calls_json.and_then(|s| serde_json::from_str(&s).ok());

            Ok(Message {
                role,
                content: row.get(1)?,
                images,
                tool_calls,
                tool_call_id: row.get(4)?,
                timestamp: row.get(5)?,
            })
        }).map_err(|e| QuasarError::database(format!("Failed to query messages: {}", e)))?;

        messages.collect::<Result<Vec<_>, _>>()
            .map_err(|e| QuasarError::database(format!("Failed to collect messages: {}", e)))
    }

    pub fn add_message(&mut self, session_id: &SessionId, message: &Message) -> QuasarResult<()> {
        let role_str = match message.role {
            quasar_core::MessageRole::User => "user",
            quasar_core::MessageRole::Assistant => "assistant",
            quasar_core::MessageRole::System => "system",
            quasar_core::MessageRole::Tool => "tool",
        };

        let images_json = message.images.as_ref().map(|i| serde_json::to_string(i).unwrap());
        let tool_calls_json = message.tool_calls.as_ref().map(|tc| serde_json::to_string(tc).unwrap());

        self.conn.execute(
            "INSERT INTO messages (session_id, role, content, images, tool_calls, tool_call_id, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session_id,
                role_str,
                message.content,
                images_json,
                tool_calls_json,
                message.tool_call_id,
                message.timestamp,
            ],
        ).map_err(|e| QuasarError::database(format!("Failed to add message: {}", e)))?;

        Ok(())
    }
}
