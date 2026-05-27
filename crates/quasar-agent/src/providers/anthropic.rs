use async_trait::async_trait;
use quasar_core::{Message, MessageRole, QuasarResult, QuasarError, ToolDef};
use serde::{Deserialize, Serialize};
use super::{Provider, CompletionOptions, CompletionResult, TokenUsage};

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    max_tokens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicTool>>,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: AnthropicContent,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum AnthropicContent {
    Text(String),
    Blocks(Vec<AnthropicContentBlock>),
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum AnthropicContentBlock {
    Text {
        text: String,
    },
    Image {
        source: AnthropicImageSource,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

#[derive(Serialize, Deserialize)]
struct AnthropicImageSource {
    r#type: String, // "base64"
    #[serde(rename = "media_type")]
    media_type: String, // e.g. "image/jpeg"
    data: String,
}

#[derive(Serialize)]
struct AnthropicTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicResponseContentBlock>,
    usage: AnthropicUsage,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum AnthropicResponseContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: usize,
    output_tokens: usize,
}

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

    fn build_tools(&self, tools: &[ToolDef]) -> Option<Vec<AnthropicTool>> {
        if tools.is_empty() {
            return None;
        }

        let declarations: Vec<AnthropicTool> = tools
            .iter()
            .map(|t| {
                let mut properties = serde_json::Value::Object(serde_json::Map::new());
                let mut required = Vec::new();

                if let Some(props) = t.parameters.properties.as_ref() {
                    let mut props_map = serde_json::Map::new();
                    for (k, v) in props {
                        props_map.insert(k.clone(), serde_json::to_value(v).unwrap_or_default());
                    }
                    properties = serde_json::Value::Object(props_map);
                }

                if let Some(req) = t.parameters.required.as_ref() {
                    required = req.clone();
                }

                let params_val = serde_json::json!({
                    "type": "object",
                    "properties": properties,
                    "required": required
                });

                AnthropicTool {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    input_schema: params_val,
                }
            })
            .collect();

        Some(declarations)
    }

    fn build_messages(&self, messages: &[Message]) -> Vec<AnthropicMessage> {
        let mut result = Vec::new();

        for msg in messages {
            match msg.role {
                MessageRole::User => {
                    if let Some(ref images) = msg.images {
                        if !images.is_empty() {
                            let mut blocks = Vec::new();
                            if !msg.content.is_empty() {
                                blocks.push(AnthropicContentBlock::Text {
                                    text: msg.content.clone(),
                                });
                            }

                            for img in images {
                                let image_parts: Vec<&str> = img.split(',').collect();
                                if image_parts.len() == 2 {
                                    let prefix = image_parts[0];
                                    let base64_data = image_parts[1];

                                    let mime_parts: Vec<&str> = prefix.split(':').collect();
                                    if mime_parts.len() >= 2 {
                                        let second_part = mime_parts[1];
                                        let type_parts: Vec<&str> = second_part.split(';').collect();
                                        if !type_parts.is_empty() {
                                            let media_type = type_parts[0].to_string();
                                            blocks.push(AnthropicContentBlock::Image {
                                                source: AnthropicImageSource {
                                                    r#type: "base64".to_string(),
                                                    media_type,
                                                    data: base64_data.to_string(),
                                                },
                                            });
                                        }
                                    }
                                }
                            }
                            result.push(AnthropicMessage {
                                role: "user".to_string(),
                                content: AnthropicContent::Blocks(blocks),
                            });
                            continue;
                        }
                    }

                    result.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: AnthropicContent::Text(msg.content.clone()),
                    });
                }
                MessageRole::Assistant => {
                    let mut blocks = Vec::new();

                    if !msg.content.is_empty() {
                        blocks.push(AnthropicContentBlock::Text {
                            text: msg.content.clone(),
                        });
                    }

                    if let Some(ref calls) = msg.tool_calls {
                        for tc in calls {
                            let input_val = serde_json::from_str(&tc.arguments).unwrap_or_default();
                            blocks.push(AnthropicContentBlock::ToolUse {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                input: input_val,
                            });
                        }
                    }

                    if !blocks.is_empty() {
                        result.push(AnthropicMessage {
                            role: "assistant".to_string(),
                            content: AnthropicContent::Blocks(blocks),
                        });
                    }
                }
                MessageRole::Tool => {
                    // Anthropic represents tool outputs as a user message containing a tool_result content block
                    let tool_result_block = AnthropicContentBlock::ToolResult {
                        tool_use_id: msg.tool_call_id.clone().unwrap_or_default(),
                        content: msg.content.clone(),
                    };

                    result.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: AnthropicContent::Blocks(vec![tool_result_block]),
                    });
                }
                MessageRole::System => {
                    // System instructions are passed separately in the request config
                }
            }
        }

        result
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    async fn complete(&self, options: CompletionOptions) -> QuasarResult<CompletionResult> {
        let url = "https://api.anthropic.com/v1/messages";

        let system = if !options.system_prompt.is_empty() {
            Some(options.system_prompt.clone())
        } else {
            None
        };

        let tools = self.build_tools(&options.tools);
        let messages = self.build_messages(&options.messages);

        let request = AnthropicRequest {
            model: options.model,
            messages,
            system,
            max_tokens: options.max_tokens,
            temperature: options.temperature,
            tools,
        };

        let response = self
            .client
            .post(url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&request)
            .send()
            .await
            .map_err(|e| QuasarError::provider(format!("Anthropic API HTTP error: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(QuasarError::provider(format!(
                "Anthropic API returned error status {}: {}",
                status, body
            )));
        }

        let anthropic_res: AnthropicResponse = response
            .json()
            .await
            .map_err(|e| QuasarError::provider(format!("Failed to parse Anthropic API response: {}", e)))?;

        let mut content = String::new();
        let mut tool_calls = Vec::new();

        for block in anthropic_res.content {
            match block {
                AnthropicResponseContentBlock::Text { text } => {
                    content.push_str(&text);
                }
                AnthropicResponseContentBlock::ToolUse { id, name, input } => {
                    let args_str = serde_json::to_string(&input).unwrap_or_default();
                    tool_calls.push(quasar_core::ToolCall {
                        id,
                        name,
                        arguments: args_str,
                    });
                }
            }
        }

        let tokens_used = TokenUsage {
            prompt_tokens: anthropic_res.usage.input_tokens,
            completion_tokens: anthropic_res.usage.output_tokens,
            total_tokens: anthropic_res.usage.input_tokens + anthropic_res.usage.output_tokens,
        };

        Ok(CompletionResult {
            content,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            tokens_used,
        })
    }
}
