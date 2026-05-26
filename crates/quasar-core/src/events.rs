use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use crate::types::session::SessionId;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum QuasarEvent {
    AgentStart {
        session_id: SessionId,
        model: String,
    },
    AgentComplete {
        session_id: SessionId,
        tokens_used: usize,
    },
    ToolCall {
        session_id: SessionId,
        tool_name: String,
        args: serde_json::Value,
    },
    ToolResult {
        session_id: SessionId,
        tool_name: String,
        success: bool,
    },
    Error {
        session_id: SessionId,
        error: String,
    },
}

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<QuasarEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self { tx }
    }

    pub fn emit(&self, event: QuasarEvent) {
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<QuasarEvent> {
        self.tx.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(1000)
    }
}

// Global event bus
lazy_static::lazy_static! {
    pub static ref GLOBAL_EVENT_BUS: EventBus = EventBus::default();
}

pub fn event_bus() -> &'static EventBus {
    &GLOBAL_EVENT_BUS
}
