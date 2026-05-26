use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: MessageRole,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    pub timestamp: i64,
}

impl Message {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: MessageRole::User,
            content: content.into(),
            images: None,
            tool_calls: None,
            tool_call_id: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: MessageRole::Assistant,
            content: content.into(),
            images: None,
            tool_calls: None,
            tool_call_id: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: MessageRole::System,
            content: content.into(),
            images: None,
            tool_calls: None,
            tool_call_id: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    pub fn tool(content: impl Into<String>, tool_call_id: impl Into<String>) -> Self {
        Self {
            role: MessageRole::Tool,
            content: content.into(),
            images: None,
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    pub fn with_images(mut self, images: Vec<String>) -> Self {
        self.images = Some(images);
        self
    }

    pub fn with_tool_calls(mut self, tool_calls: Vec<ToolCall>) -> Self {
        self.tool_calls = Some(tool_calls);
        self
    }
}
