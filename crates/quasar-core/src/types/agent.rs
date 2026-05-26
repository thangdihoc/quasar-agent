use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderName {
    OpenAI,
    Anthropic,
    Google,
    OpenRouter,
    Ollama,
}

impl ProviderName {
    pub fn from_model(model: &str) -> Self {
        if model.starts_with("openrouter/") {
            Self::OpenRouter
        } else if model.starts_with("ollama/") {
            Self::Ollama
        } else if model.contains("claude") {
            Self::Anthropic
        } else if model.contains("gemini") {
            Self::Google
        } else if model.contains("gpt") || model.contains("o1") || model.contains("o3") || model.contains("o4") {
            Self::OpenAI
        } else {
            Self::OpenAI // default
        }
    }

    pub fn strip_prefix<'a>(&self, model: &'a str) -> &'a str {
        match self {
            Self::OpenRouter => model.strip_prefix("openrouter/").unwrap_or(model),
            Self::Ollama => model.strip_prefix("ollama/").unwrap_or(model),
            _ => model,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub model: String,
    pub thinking_level: ThinkingLevel,
    pub max_tokens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: "gpt-4o".to_string(),
            thinking_level: ThinkingLevel::Medium,
            max_tokens: 4096,
            system_prompt: None,
        }
    }
}
