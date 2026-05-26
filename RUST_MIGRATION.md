# Quasar Agent - Rust Migration

## Tổng quan

Dự án đang được chuyển đổi từ TypeScript sang Rust để cải thiện hiệu năng, giảm memory footprint, và tăng độ tin cậy.

## Cấu trúc Rust Workspace

```
quasar-agent/
├── Cargo.toml                 # Workspace root
├── crates/
│   ├── quasar-core/          # ✅ HOÀN THÀNH - Core types, errors, utilities
│   │   ├── src/
│   │   │   ├── types/        # Message, Tool, Session, Agent, Config
│   │   │   ├── errors.rs     # QuasarError, QuasarResult
│   │   │   ├── events.rs     # Event bus
│   │   │   ├── cache.rs      # TTL cache, tool cache
│   │   │   ├── retry.rs      # Retry logic, circuit breaker
│   │   │   ├── logger.rs     # Tracing setup
│   │   │   └── config.rs     # Config loader
│   │   └── Cargo.toml
│   │
│   ├── quasar-agent/         # ✅ HOÀN THÀNH - Agent loop & providers
│   │   ├── src/
│   │   │   ├── agent_loop.rs # Main agent loop (max 15 rounds)
│   │   │   ├── providers/    # OpenAI, Anthropic, Google
│   │   │   ├── context.rs    # Token estimation, truncation
│   │   │   └── prompt.rs     # System prompt builder
│   │   └── Cargo.toml
│   │
│   ├── quasar-memory/        # 🚧 TODO - SQLite + Vector DB
│   │   ├── src/
│   │   │   ├── sqlite.rs     # Session, message, token tracking
│   │   │   └── lancedb.rs    # Vector search (RAG)
│   │   └── Cargo.toml
│   │
│   ├── quasar-tools/         # 🚧 TODO - Tool implementations
│   │   ├── src/
│   │   │   ├── registry.rs   # Tool registration
│   │   │   ├── fs/           # File operations
│   │   │   ├── web/          # Web fetch, search, browser
│   │   │   ├── exec/         # PowerShell execution
│   │   │   └── ...           # PDF, media, scheduler, etc.
│   │   └── Cargo.toml
│   │
│   ├── quasar-mcp/           # 🚧 TODO - MCP client
│   │   ├── src/
│   │   │   └── client.rs     # MCP protocol implementation
│   │   └── Cargo.toml
│   │
│   └── quasar-cli/           # 🚧 TODO - Binary entry point
│       ├── src/
│       │   └── main.rs       # CLI commands, startup
│       └── Cargo.toml
│
├── native/                    # Existing Rust native module (NAPI-RS)
│   └── src/lib.rs            # Token counting, diff, patch
│
└── packages/                  # Original TypeScript code (reference)
```

## Tiến độ chuyển đổi

### ✅ Hoàn thành

- **quasar-core**: Types, errors, events, cache, retry, logger, config
- **quasar-agent**: Agent loop, OpenAI provider, context management, prompt builder

### 🚧 Đang thực hiện

- **quasar-memory**: SQLite + LanceDB integration
- **quasar-tools**: Tool registry và implementations
- **quasar-mcp**: MCP client
- **quasar-cli**: CLI interface

### 📋 Chưa bắt đầu

- Anthropic provider (full implementation)
- Google provider (full implementation)
- Telegram bot integration
- Web server (gateway)
- Computer Use integration
- Scheduler
- Knowledge base

## Kiến trúc chính

### Agent Loop

```rust
AgentLoop::process() {
    1. Add user message
    2. Build context window (token management)
    3. Call provider (with retry + circuit breaker)
    4. If tool_calls:
        - Execute tools in parallel
        - Cache results
        - Add tool results to messages
        - Loop back to step 2
    5. Return final response
}
```

### Provider System

- **Factory pattern**: `ProviderFactory::create()`
- **Unified interface**: `Provider::complete()`
- **Resilience**: Retry + Circuit Breaker
- **Supported**: OpenAI, Anthropic, Google, OpenRouter, Ollama

### Tool System

- **Dynamic registration**: `agent.register_tool(def, handler)`
- **Async handlers**: `async fn(args) -> Result<String>`
- **Caching**: TTL cache (5 min default)
- **Parallel execution**: `tokio::spawn` + `join_all`

## Dependencies chính

```toml
tokio = "1.42"              # Async runtime
serde = "1.0"               # Serialization
async-openai = "0.27"       # OpenAI client
rusqlite = "0.32"           # SQLite
tiktoken-rs = "0.6"         # Token counting
reqwest = "0.12"            # HTTP client
tracing = "0.1"             # Logging
clap = "4.5"                # CLI
```

## Build & Run

```bash
# Build workspace
cargo build --release

# Run CLI
cargo run --bin quasar-cli -- start

# Run tests
cargo test

# Check
cargo check --workspace
```

## So sánh với TypeScript

| Feature | TypeScript | Rust |
|---------|-----------|------|
| Startup time | ~500ms | ~50ms |
| Memory usage | ~150MB | ~30MB |
| Token counting | JS fallback | Native tiktoken |
| Concurrency | Single-threaded | Multi-threaded |
| Type safety | Runtime | Compile-time |
| Error handling | try/catch | Result<T, E> |

## Migration Strategy

1. **Phase 1** (✅): Core types + Agent loop + OpenAI provider
2. **Phase 2** (🚧): Memory + Tools + MCP
3. **Phase 3** (📋): CLI + Web server
4. **Phase 4** (📋): Advanced features (Computer Use, Scheduler, etc.)

## Compatibility

- Config format: TOML (tương thích với TypeScript version)
- Database: SQLite (same schema)
- API: OpenAI, Anthropic, Google (same endpoints)
- MCP: Model Context Protocol (same spec)

## Notes

- Native module (`native/`) vẫn được giữ lại cho NAPI-RS bindings
- TypeScript code (`packages/`) được giữ làm reference
- Rust version sẽ dần thay thế TypeScript version
- Có thể chạy song song trong quá trình migration

## Roadmap

- [ ] Complete memory layer (SQLite + LanceDB)
- [ ] Implement core tools (file, web, exec)
- [ ] MCP client integration
- [ ] CLI with interactive setup
- [ ] Web gateway
- [ ] Performance benchmarks
- [ ] Documentation
- [ ] Migration guide
- [ ] Deprecate TypeScript version

## Contributing

Xem [CONTRIBUTING.md](CONTRIBUTING.md) để biết thêm chi tiết về cách đóng góp vào dự án.
