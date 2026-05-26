use thiserror::Error;

pub type QuasarResult<T> = Result<T, QuasarError>;

#[derive(Error, Debug)]
pub enum QuasarError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Provider error: {0}")]
    Provider(String),

    #[error("Memory error: {0}")]
    Memory(String),

    #[error("Tool error: {0}")]
    Tool(String),

    #[error("MCP error: {0}")]
    Mcp(String),

    #[error("Rate limit exceeded: {0}")]
    RateLimit(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl QuasarError {
    pub fn config(msg: impl Into<String>) -> Self {
        Self::Config(msg.into())
    }

    pub fn provider(msg: impl Into<String>) -> Self {
        Self::Provider(msg.into())
    }

    pub fn memory(msg: impl Into<String>) -> Self {
        Self::Memory(msg.into())
    }

    pub fn tool(msg: impl Into<String>) -> Self {
        Self::Tool(msg.into())
    }

    pub fn mcp(msg: impl Into<String>) -> Self {
        Self::Mcp(msg.into())
    }

    pub fn rate_limit(msg: impl Into<String>) -> Self {
        Self::RateLimit(msg.into())
    }

    pub fn database(msg: impl Into<String>) -> Self {
        Self::Database(msg.into())
    }

    pub fn unknown(msg: impl Into<String>) -> Self {
        Self::Unknown(msg.into())
    }
}
