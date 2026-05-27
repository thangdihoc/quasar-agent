use async_trait::async_trait;
use quasar_core::{Message, MessageRole, QuasarResult, QuasarError, ToolDef};
use serde::{Deserialize, Serialize};
use super::{Provider, CompletionOptions, CompletionResult, TokenUsage};

#[derive(Serialize)]
struct GeminiPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(rename = "inlineData", skip_serializing_if = "Option::is_none")]
    inline_data: Option<GeminiInlineData>,
    #[serde(rename = "functionCall", skip_serializing_if = "Option::is_none")]
    function_call: Option<GeminiFunctionCall>,
    #[serde(rename = "functionResponse", skip_serializing_if = "Option::is_none")]
    function_response: Option<GeminiFunctionResponse>,
}

#[derive(Serialize)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Serialize)]
struct GeminiFunctionCall {
    name: String,
    args: serde_json::Value,
}

#[derive(Serialize)]
struct GeminiFunctionResponse {
    name: String,
    response: serde_json::Value,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiSystemInstruction {
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiFunctionDeclaration {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Serialize)]
struct GeminiTool {
    #[serde(rename = "functionDeclarations")]
    function_declarations: Vec<GeminiFunctionDeclaration>,
}

#[derive(Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "maxOutputTokens", skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "systemInstruction", skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiSystemInstruction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<GeminiTool>>,
    #[serde(rename = "generationConfig", skip_serializing_if = "Option::is_none")]
    generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiResponseContent>,
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct GeminiResponseContent {
    #[serde(default)]
    parts: Option<Vec<GeminiResponsePart>>,
}

#[derive(Deserialize)]
struct GeminiResponsePart {
    text: Option<String>,
    #[serde(rename = "functionCall")]
    function_call: Option<GeminiResponseFunctionCall>,
}

#[derive(Deserialize)]
struct GeminiResponseFunctionCall {
    name: String,
    args: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GeminiUsageMetadata {
    #[serde(rename = "promptTokenCount")]
    prompt_token_count: Option<usize>,
    #[serde(rename = "candidatesTokenCount")]
    candidates_token_count: Option<usize>,
    #[serde(rename = "totalTokenCount")]
    total_token_count: Option<usize>,
}

pub struct GoogleProvider {
    api_key: String,
    client: reqwest::Client,
}

impl GoogleProvider {
    pub fn new(api_key: impl Into<String>) -> QuasarResult<Self> {
        Ok(Self {
            api_key: api_key.into(),
            client: reqwest::Client::new(),
        })
    }

    fn capitalize_types(val: &mut serde_json::Value) {
        if let serde_json::Value::Object(ref mut map) = val {
            if let Some(t) = map.get_mut("type") {
                if let serde_json::Value::String(ref mut s) = t {
                    *s = s.to_uppercase();
                }
            }
            for (_, child) in map.iter_mut() {
                Self::capitalize_types(child);
            }
        } else if let serde_json::Value::Array(ref mut arr) = val {
            for child in arr.iter_mut() {
                Self::capitalize_types(child);
            }
        }
    }

    fn build_tools(&self, tools: &[ToolDef]) -> Option<Vec<GeminiTool>> {
        if tools.is_empty() {
            return None;
        }

        let declarations: Vec<GeminiFunctionDeclaration> = tools
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

                let mut params_val = serde_json::json!({
                    "type": "OBJECT",
                    "properties": properties,
                    "required": required
                });
                
                Self::capitalize_types(&mut params_val);

                GeminiFunctionDeclaration {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    parameters: params_val,
                }
            })
            .collect();

        Some(vec![GeminiTool {
            function_declarations: declarations,
        }])
    }

    fn build_contents(&self, messages: &[Message]) -> Vec<GeminiContent> {
        let mut result = Vec::new();

        for msg in messages {
            let mut parts = Vec::new();

            match msg.role {
                MessageRole::User => {
                    if !msg.content.is_empty() {
                        parts.push(GeminiPart {
                            text: Some(msg.content.clone()),
                            inline_data: None,
                            function_call: None,
                            function_response: None,
                        });
                    }

                    if let Some(ref images) = msg.images {
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
                                        let mime_type = type_parts[0].to_string();
                                        parts.push(GeminiPart {
                                            text: None,
                                            inline_data: Some(GeminiInlineData {
                                                mime_type,
                                                data: base64_data.to_string(),
                                            }),
                                            function_call: None,
                                            function_response: None,
                                        });
                                    }
                                }
                            }
                        }
                    }

                    if !parts.is_empty() {
                        result.push(GeminiContent {
                            role: "user".to_string(),
                            parts,
                        });
                    }
                }
                MessageRole::Assistant => {
                    if !msg.content.is_empty() {
                        parts.push(GeminiPart {
                            text: Some(msg.content.clone()),
                            inline_data: None,
                            function_call: None,
                            function_response: None,
                        });
                    }

                    if let Some(ref calls) = msg.tool_calls {
                        for tc in calls {
                            let args_val = serde_json::from_str(&tc.arguments).unwrap_or_default();
                            parts.push(GeminiPart {
                                text: None,
                                inline_data: None,
                                function_call: Some(GeminiFunctionCall {
                                    name: tc.name.clone(),
                                    args: args_val,
                                }),
                                function_response: None,
                            });
                        }
                    }

                    if !parts.is_empty() {
                        result.push(GeminiContent {
                            role: "model".to_string(),
                            parts,
                        });
                    }
                }
                MessageRole::Tool => {
                    // Gemini requires matching the original tool name. Try finding it in past history.
                    let mut func_name = "tool_result".to_string();
                    if let Some(ref tc_id) = msg.tool_call_id {
                        for prev_msg in messages.iter() {
                            if let Some(ref calls) = prev_msg.tool_calls {
                                for call in calls.iter() {
                                    if &call.id == tc_id {
                                        func_name = call.name.clone();
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    parts.push(GeminiPart {
                        text: None,
                        inline_data: None,
                        function_call: None,
                        function_response: Some(GeminiFunctionResponse {
                            name: func_name,
                            response: serde_json::json!({ "result": msg.content }),
                        }),
                    });

                    result.push(GeminiContent {
                        role: "function".to_string(),
                        parts,
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
impl Provider for GoogleProvider {
    async fn complete(&self, options: CompletionOptions) -> QuasarResult<CompletionResult> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            options.model, self.api_key
        );

        let system_instruction = if !options.system_prompt.is_empty() {
            Some(GeminiSystemInstruction {
                parts: vec![GeminiPart {
                    text: Some(options.system_prompt.clone()),
                    inline_data: None,
                    function_call: None,
                    function_response: None,
                }],
            })
        } else {
            None
        };

        let tools = self.build_tools(&options.tools);
        let contents = self.build_contents(&options.messages);

        let request = GeminiRequest {
            contents,
            system_instruction,
            tools,
            generation_config: Some(GeminiGenerationConfig {
                max_output_tokens: Some(options.max_tokens),
                temperature: options.temperature,
            }),
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| QuasarError::provider(format!("Google API HTTP error: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(QuasarError::provider(format!(
                "Google API returned error status {}: {}",
                status, body
            )));
        }

        let gemini_res: GeminiResponse = response
            .json()
            .await
            .map_err(|e| QuasarError::provider(format!("Failed to parse Google API response: {}", e)))?;

        let candidate = gemini_res
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .ok_or_else(|| QuasarError::provider("No candidates returned from Google API"))?;

        let mut content = String::new();
        let mut tool_calls = Vec::new();

        if let Some(ref candidate_content) = candidate.content {
            if let Some(ref parts) = candidate_content.parts {
                for part in parts {
                    if let Some(ref text) = part.text {
                        content.push_str(text);
                    }
                    if let Some(ref fc) = part.function_call {
                        let id = format!(
                            "google_{}_{}",
                            chrono::Utc::now().timestamp_millis(),
                            uuid::Uuid::new_v4().to_string()[..6].to_string()
                        );
                        let args_str = if let Some(ref args) = fc.args {
                            serde_json::to_string(args).unwrap_or_default()
                        } else {
                            "{}".to_string()
                        };
                        tool_calls.push(quasar_core::ToolCall {
                            id,
                            name: fc.name.clone(),
                            arguments: args_str,
                        });
                    }
                }
            }
        }

        let mut tokens_used = TokenUsage::default();
        if let Some(ref usage) = gemini_res.usage_metadata {
            tokens_used.prompt_tokens = usage.prompt_token_count.unwrap_or(0);
            tokens_used.completion_tokens = usage.candidates_token_count.unwrap_or(0);
            tokens_used.total_tokens = usage.total_token_count.unwrap_or(0);
        }

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
