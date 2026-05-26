// quasar-core - Core types, errors, and utilities

pub mod types;
pub mod errors;
pub mod logger;
pub mod events;
pub mod cache;
pub mod retry;
pub mod config;

pub use errors::{QuasarError, QuasarResult};
pub use types::{
    message::{Message, MessageRole, ToolCall},
    tool::{Tool, ToolDef, ToolParameter},
    session::{Session, SessionId},
    agent::{AgentConfig, ProviderName},
    config::QuasarConfig,
};
pub use logger::{init_logger, LogLevel};
pub use events::{EventBus, QuasarEvent};
pub use cache::{TtlCache, ToolCache};
pub use retry::{RetryOptions, CircuitBreaker, with_retry};
