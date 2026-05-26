use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::agent::{AgentConfig, ProviderName};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    pub port: u16,
    pub host: String,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            port: 18789,
            host: "127.0.0.1".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    pub token: String,
    pub allowed_users: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsConfig {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub exec_requires_approval: bool,
}

impl Default for ToolsConfig {
    fn default() -> Self {
        Self {
            allow: vec![
                "exec".to_string(),
                "file_read".to_string(),
                "file_write".to_string(),
                "file_edit".to_string(),
                "file_list".to_string(),
                "web_fetch".to_string(),
                "web_search".to_string(),
            ],
            deny: Vec::new(),
            exec_requires_approval: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    pub sqlite_path: String,
    pub lancedb_path: String,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            sqlite_path: "./data/memory.db".to_string(),
            lancedb_path: "./data/lancedb".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    pub servers: Vec<McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputerUseConfig {
    pub enabled: bool,
    pub python_port: u16,
}

impl Default for ComputerUseConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            python_port: 18790,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuasarConfig {
    #[serde(default)]
    pub gateway: GatewayConfig,
    #[serde(default)]
    pub agent: AgentConfig,
    pub telegram: TelegramConfig,
    #[serde(default)]
    pub providers: HashMap<String, ProviderConfig>,
    #[serde(default)]
    pub tools: ToolsConfig,
    #[serde(default)]
    pub memory: MemoryConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp: Option<McpConfig>,
    #[serde(default)]
    pub computer_use: ComputerUseConfig,
    #[serde(default)]
    pub web: WebConfig,
}
