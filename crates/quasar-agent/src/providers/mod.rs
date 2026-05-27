use async_trait::async_trait;
use quasar_core::{Message, ToolDef, QuasarResult, QuasarConfig, ProviderName};
use serde::{Deserialize, Serialize};

pub mod openai;
pub mod anthropic;
pub mod google;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionOptions {
    pub model: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolDef>,
    pub system_prompt: String,
    pub max_tokens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResult {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<quasar_core::ToolCall>>,
    pub tokens_used: TokenUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub prompt_tokens: usize,
    pub completion_tokens: usize,
    pub total_tokens: usize,
}

#[async_trait]
pub trait Provider: Send + Sync {
    async fn complete(&self, options: CompletionOptions) -> QuasarResult<CompletionResult>;
}

pub struct ProviderFactory;

impl ProviderFactory {
    pub fn create(provider: ProviderName, config: &QuasarConfig) -> QuasarResult<Box<dyn Provider>> {
        match provider {
            ProviderName::OpenAI => {
                let api_key = config
                    .providers
                    .get("openai")
                    .and_then(|p| p.api_key.clone())
                    .or_else(|| std::env::var("OPENAI_API_KEY").ok())
                    .ok_or_else(|| quasar_core::QuasarError::config("OPENAI_API_KEY not configured"))?;
                
                let base_url = config
                    .providers
                    .get("openai")
                    .and_then(|p| p.base_url.clone());

                Ok(Box::new(openai::OpenAIProvider::new(api_key, base_url)?))
            }
            ProviderName::Anthropic => {
                let api_key = config
                    .providers
                    .get("anthropic")
                    .and_then(|p| p.api_key.clone())
                    .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
                    .ok_or_else(|| quasar_core::QuasarError::config("ANTHROPIC_API_KEY not configured"))?;

                Ok(Box::new(anthropic::AnthropicProvider::new(api_key)?))
            }
            ProviderName::Google => {
                let api_key = config
                    .providers
                    .get("google")
                    .and_then(|p| p.api_key.clone())
                    .or_else(|| std::env::var("GOOGLE_API_KEY").ok())
                    .ok_or_else(|| quasar_core::QuasarError::config("GOOGLE_API_KEY not configured"))?;

                Ok(Box::new(google::GoogleProvider::new(api_key)?))
            }
            ProviderName::OpenRouter => {
                let api_key = config
                    .providers
                    .get("openrouter")
                    .and_then(|p| p.api_key.clone())
                    .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
                    .ok_or_else(|| quasar_core::QuasarError::config("OPENROUTER_API_KEY not configured"))?;

                let base_url = Some("https://openrouter.ai/api/v1");
                Ok(Box::new(openai::OpenAIProvider::new(api_key, base_url)?))
            }
            ProviderName::Ollama => {
                let base_url = config
                    .providers
                    .get("ollama")
                    .and_then(|p| p.base_url.clone())
                    .or_else(|| std::env::var("OLLAMA_BASE_URL").ok())
                    .unwrap_or_else(|| "http://localhost:11434/v1".to_string());

                Ok(Box::new(openai::OpenAIProvider::new("ollama", Some(base_url))?))
            }
        }
    }
}
