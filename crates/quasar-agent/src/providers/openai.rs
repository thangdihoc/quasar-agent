use async_trait::async_trait;
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
        ChatCompletionRequestUserMessage, ChatCompletionRequestAssistantMessage,
        ChatCompletionRequestToolMessage, ChatCompletionTool, ChatCompletionToolType,
        CreateChatCompletionRequest, CreateChatCompletionRequestArgs,
        FunctionObject, FunctionObjectArgs,
    },
    Client,
};
use quasar_core::{Message, MessageRole, QuasarResult, QuasarError};
use super::{Provider, CompletionOptions, CompletionResult, TokenUsage};

pub struct OpenAIProvider {
    client: Client<OpenAIConfig>,
}

impl OpenAIProvider {
    pub fn new(api_key: impl Into<String>, base_url: Option<impl Into<String>>) -> QuasarResult<Self> {
        let mut config = OpenAIConfig::new().with_api_key(api_key);
        
        if let Some(url) = base_url {
            config = config.with_api_base(url);
        }

        Ok(Self {
            client: Client::with_config(config),
        })
    }

    fn convert_message(&self, msg: &Message) -> ChatCompletionRequestMessage {
        match msg.role {
            MessageRole::System => {
                ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
                    content: msg.content.clone().into(),
                    name: None,
                })
            }
            MessageRole::User => {
                ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
                    content: msg.content.clone().into(),
                    name: None,
                })
            }
            MessageRole::Assistant => {
                ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
                    content: Some(msg.content.clone()),
                    tool_calls: msg.tool_calls.as_ref().map(|calls| {
                        calls
                            .iter()
                            .map(|tc| async_openai::types::ChatCompletionMessageToolCall {
                                id: tc.id.clone(),
                                r#type: ChatCompletionToolType::Function,
                                function: async_openai::types::FunctionCall {
                                    name: tc.name.clone(),
                                    arguments: tc.arguments.clone(),
                                },
                            })
                            .collect()
                    }),
                    ..Default::default()
                })
            }
            MessageRole::Tool => {
                ChatCompletionRequestMessage::Tool(ChatCompletionRequestToolMessage {
                    content: msg.content.clone().into(),
                    tool_call_id: msg.tool_call_id.clone().unwrap_or_default(),
                })
            }
        }
    }
}

#[async_trait]
impl Provider for OpenAIProvider {
    async fn complete(&self, options: CompletionOptions) -> QuasarResult<CompletionResult> {
        let mut messages = vec![self.convert_message(&Message::system(&options.system_prompt))];
        messages.extend(options.messages.iter().map(|m| self.convert_message(m)));

        let tools: Vec<ChatCompletionTool> = options
            .tools
            .iter()
            .map(|tool| {
                let function = FunctionObjectArgs::default()
                    .name(&tool.name)
                    .description(&tool.description)
                    .parameters(serde_json::to_value(&tool.parameters).unwrap_or_default())
                    .build()
                    .unwrap();

                ChatCompletionTool {
                    r#type: ChatCompletionToolType::Function,
                    function,
                }
            })
            .collect();

        let mut request_builder = CreateChatCompletionRequestArgs::default();
        request_builder
            .model(&options.model)
            .messages(messages)
            .max_tokens(options.max_tokens as u32);

        if !tools.is_empty() {
            request_builder.tools(tools);
        }

        if let Some(temp) = options.temperature {
            request_builder.temperature(temp);
        }

        let request = request_builder
            .build()
            .map_err(|e| QuasarError::provider(format!("Failed to build request: {}", e)))?;

        let response = self
            .client
            .chat()
            .create(request)
            .await
            .map_err(|e| QuasarError::provider(format!("OpenAI API error: {}", e)))?;

        let choice = response
            .choices
            .first()
            .ok_or_else(|| QuasarError::provider("No choices in response"))?;

        let content = choice
            .message
            .content
            .clone()
            .unwrap_or_default();

        let tool_calls = choice.message.tool_calls.as_ref().map(|calls| {
            calls
                .iter()
                .map(|tc| quasar_core::ToolCall {
                    id: tc.id.clone(),
                    name: tc.function.name.clone(),
                    arguments: tc.function.arguments.clone(),
                })
                .collect()
        });

        let tokens_used = TokenUsage {
            prompt_tokens: response.usage.as_ref().map(|u| u.prompt_tokens as usize).unwrap_or(0),
            completion_tokens: response.usage.as_ref().map(|u| u.completion_tokens as usize).unwrap_or(0),
            total_tokens: response.usage.as_ref().map(|u| u.total_tokens as usize).unwrap_or(0),
        };

        Ok(CompletionResult {
            content,
            tool_calls,
            tokens_used,
        })
    }
}
