use dashmap::DashMap;
use quasar_core::{
    Message, MessageRole, QuasarConfig, QuasarError, QuasarResult, SessionId, ToolDef, ProviderName,
    GLOBAL_EVENT_BUS, event_bus, QuasarEvent, with_retry, RetryOptions, CircuitBreaker, ToolCache, tool_cache_key,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{info, warn, error};

use crate::context::{build_context_window, estimate_tokens, truncate_tool_output};
use crate::prompt::build_system_prompt;
use crate::providers::{CompletionOptions, Provider, ProviderFactory};

const MAX_TOOL_ROUNDS: usize = 15;
const MAX_CONTEXT_TOKENS: usize = 120_000;

type ToolHandler = Arc<dyn Fn(serde_json::Value) -> std::pin::Pin<Box<dyn std::future::Future<Output = QuasarResult<String>> + Send>> + Send + Sync>;

pub struct AgentLoop {
    config: QuasarConfig,
    providers: Arc<DashMap<String, Box<dyn Provider>>>,
    circuit_breakers: Arc<DashMap<String, CircuitBreaker>>,
    tools: Arc<RwLock<Vec<ToolDef>>>,
    tool_handlers: Arc<DashMap<String, ToolHandler>>,
    tool_cache: ToolCache,
    default_model: String,
    session_models: Arc<DashMap<SessionId, String>>,
}

impl AgentLoop {
    pub fn new(config: QuasarConfig) -> Self {
        let default_model = config.agent.model.clone();
        info!("Agent loop initialized with default model: {}", default_model);

        Self {
            config,
            providers: Arc::new(DashMap::new()),
            circuit_breakers: Arc::new(DashMap::new()),
            tools: Arc::new(RwLock::new(Vec::new())),
            tool_handlers: Arc::new(DashMap::new()),
            tool_cache: ToolCache::new(Duration::from_secs(300)), // 5 min TTL
            default_model,
            session_models: Arc::new(DashMap::new()),
        }
    }

    pub async fn register_tool<F, Fut>(&self, def: ToolDef, handler: F)
    where
        F: Fn(serde_json::Value) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = QuasarResult<String>> + Send + 'static,
    {
        let name = def.name.clone();
        self.tools.write().await.push(def);
        
        let handler: ToolHandler = Arc::new(move |args| {
            Box::pin(handler(args))
        });
        
        self.tool_handlers.insert(name.clone(), handler);
        info!("Tool registered: {}", name);
    }

    pub async fn get_tools(&self) -> Vec<ToolDef> {
        self.tools.read().await.clone()
    }

    pub fn set_model(&self, model: impl Into<String>, session_id: Option<SessionId>) {
        let model = model.into();
        if let Some(sid) = session_id {
            let old_model = self.get_model(Some(&sid));
            self.session_models.insert(sid.clone(), model.clone());
            info!("Model changed for session {}: {} -> {}", sid, old_model, model);
        } else {
            info!("Default model changed: {} -> {}", self.default_model, model);
        }
    }

    pub fn get_model(&self, session_id: Option<&SessionId>) -> String {
        session_id
            .and_then(|sid| self.session_models.get(sid).map(|m| m.clone()))
            .unwrap_or_else(|| self.default_model.clone())
    }

    fn get_provider(&self, model: &str) -> QuasarResult<Box<dyn Provider>> {
        let provider_name = ProviderName::from_model(model);
        let cache_key = format!("{:?}", provider_name);

        if let Some(provider) = self.providers.get(&cache_key) {
            // Can't clone Box<dyn Provider>, so we need to recreate
            // This is a limitation - in production, consider using Arc<dyn Provider>
        }

        // Create new provider
        let provider = ProviderFactory::create(provider_name, &self.config)?;
        Ok(provider)
    }

    fn get_circuit_breaker(&self, provider_name: &str) -> CircuitBreaker {
        self.circuit_breakers
            .entry(provider_name.to_string())
            .or_insert_with(|| {
                CircuitBreaker::new(
                    provider_name,
                    5,
                    Duration::from_secs(60),
                )
            });
        
        self.circuit_breakers
            .get(provider_name)
            .map(|cb| cb.value().clone())
            .unwrap()
    }

    pub async fn process(
        &self,
        session_id: SessionId,
        user_message: String,
        messages: Vec<Message>,
        options: ProcessOptions,
    ) -> QuasarResult<ProcessResult> {
        let current_model = self.get_model(Some(&session_id));
        
        event_bus().emit(QuasarEvent::AgentStart {
            session_id: session_id.clone(),
            model: current_model.clone(),
        });

        let mut all_messages = messages;
        all_messages.push(Message::user(&user_message));

        let system_prompt = build_system_prompt(&self.config, None);
        let tools = self.get_tools().await;

        let mut round = 0;
        let mut total_tokens = 0;

        loop {
            round += 1;
            if round > MAX_TOOL_ROUNDS {
                warn!("Max tool rounds ({}) reached for session {}", MAX_TOOL_ROUNDS, session_id);
                break;
            }

            // Build context window
            let context_messages = build_context_window(&all_messages, MAX_CONTEXT_TOKENS);

            // Get provider
            let provider = self.get_provider(&current_model)?;
            let provider_name = ProviderName::from_model(&current_model);
            let model_name = provider_name.strip_prefix(&current_model);

            // Prepare completion options
            let completion_opts = CompletionOptions {
                model: model_name.to_string(),
                messages: context_messages,
                tools: tools.clone(),
                system_prompt: system_prompt.clone(),
                max_tokens: self.config.agent.max_tokens,
                temperature: None,
            };

            // Call provider with retry + circuit breaker
            let circuit_breaker = self.get_circuit_breaker(&format!("{:?}", provider_name));
            
            let result = circuit_breaker
                .execute(|| async {
                    with_retry(
                        || provider.complete(completion_opts.clone()),
                        RetryOptions::default(),
                    )
                    .await
                })
                .await?;

            total_tokens += result.tokens_used.total_tokens;

            // Handle response
            if let Some(tool_calls) = result.tool_calls {
                // Assistant wants to call tools
                all_messages.push(Message::assistant(&result.content).with_tool_calls(tool_calls.clone()));

                // Execute tools in parallel
                let mut tool_futures = Vec::new();
                for tool_call in &tool_calls {
                    let tool_name = tool_call.name.clone();
                    let tool_args = tool_call.arguments.clone();
                    let tool_id = tool_call.id.clone();
                    let handlers = Arc::clone(&self.tool_handlers);
                    let cache = self.tool_cache.clone();

                    tool_futures.push(tokio::spawn(async move {
                        // Check cache
                        let cache_key = tool_cache_key(&tool_name, &serde_json::from_str(&tool_args).unwrap_or_default());
                        if let Some(cached) = cache.get(&cache_key) {
                            info!("Tool cache hit: {}", tool_name);
                            let cache_res: Result<String, String> = Ok(cached);
                            return (tool_id, cache_res);
                        }

                        // Execute tool
                        event_bus().emit(QuasarEvent::ToolCall {
                            session_id: "".to_string(), // TODO: pass session_id
                            tool_name: tool_name.clone(),
                            args: serde_json::from_str(&tool_args).unwrap_or_default(),
                        });

                        let result = if let Some(handler) = handlers.get(&tool_name) {
                            let args: serde_json::Value = serde_json::from_str(&tool_args)
                                .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                            handler(args).await
                        } else {
                            Err(QuasarError::tool(format!("Tool not found: {}", tool_name)))
                        };

                        // Cache successful results
                        if let Ok(ref output) = result {
                            cache.insert(cache_key, output.clone());
                        }

                        event_bus().emit(QuasarEvent::ToolResult {
                            session_id: "".to_string(),
                            tool_name: tool_name.clone(),
                            success: result.is_ok(),
                        });

                        // Wrap result to match type for join_all/tokio::spawn
                        let mapped_result: Result<String, String> = result.map_err(|e| e.to_string());
                        (tool_id, mapped_result)
                    }));
                }

                // Wait for all tools
                let tool_results = futures::future::join_all(tool_futures).await;

                for result in tool_results {
                    match result {
                        Ok((tool_id, Ok(output))) => {
                            let truncated = truncate_tool_output(&output, 2000);
                            all_messages.push(Message::tool(truncated, tool_id));
                        }
                        Ok((tool_id, Err(e_str))) => {
                            let error_msg = format!("Tool error: {}", e_str);
                            error!("{}", error_msg);
                            all_messages.push(Message::tool(error_msg, tool_id));
                        }
                        Err(e) => {
                            error!("Tool execution panic: {}", e);
                        }
                    }
                }

                // Continue loop to get next response
                continue;
            } else {
                // Final response
                all_messages.push(Message::assistant(&result.content));
                
                event_bus().emit(QuasarEvent::AgentComplete {
                    session_id: session_id.clone(),
                    tokens_used: total_tokens,
                });

                return Ok(ProcessResult {
                    content: result.content,
                    messages: all_messages,
                    tokens_used: total_tokens,
                    rounds: round,
                });
            }
        }

        Err(QuasarError::unknown("Agent loop terminated without final response"))
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProcessOptions {
    pub stream: bool,
}

#[derive(Debug, Clone)]
pub struct ProcessResult {
    pub content: String,
    pub messages: Vec<Message>,
    pub tokens_used: usize,
    pub rounds: usize,
}
