use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type SessionId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: SessionId,
    pub user_id: i64,
    pub chat_id: i64,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<SessionId>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Session {
    pub fn new(user_id: i64, chat_id: i64, model: impl Into<String>) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id: Uuid::new_v4().to_string(),
            user_id,
            chat_id,
            model: model.into(),
            title: None,
            forked_from: None,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn forked_from(mut self, parent_id: SessionId) -> Self {
        self.forked_from = Some(parent_id);
        self
    }
}
