use async_trait::async_trait;
use quasar_core::{QuasarResult, QuasarError};
use super::{Provider, CompletionOptions, CompletionResult, TokenUsage};

pub struct AnthropicProvider {
    api_key: String,
    client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(api_key: impl Into<String>) -> QuasarResult<Self> {
        Ok(Self {
            api_key: api_key.into(),
            client: reqwest::Client::new(),
        })
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    async fn complete(&self, options: CompletionOptions) -> QuasarResult<CompletionResult> {
        // TODO: Implement Anthropic API integration
        // For now, return a placeholder
        Err(QuasarError::provider("Anthropic provider not yet implemented in Rust version"))
    }
}
