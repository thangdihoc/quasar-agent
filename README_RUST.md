# Quasar Agent - Rust Edition 🦀

> Quasar được định hướng Rust-first: Rust là lõi runtime chính, còn TypeScript/Python chỉ làm tầng phụ trợ khi cần.

[![Rust](https://img.shields.io/badge/rust-1.70%2B-orange.svg)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 🚀 Tính năng

- **Rust core runtime**: agent loop, OpenAI provider, context management, prompt builder
- **Basic CLI**: `quasar setup`, `quasar start`, `quasar model`, `quasar version`
- **Tool System**: built-in file and web tools plus command execution
- **Resilience**: Retry logic + circuit breaker
- **Performance**: Native Rust với tiktoken-rs
- **Async**: Tokio runtime, parallel tool execution
- **Type-safe**: Compile-time guarantees

> Lưu ý: Anthropic/Google provider support và MCP, memory/RAG vẫn đang trong giai đoạn tiếp theo.
> Legacy TypeScript/Python code đã được chuyển vào `legacy/`; các tính năng mới nên được xây dựng trên Rust.

## 📦 Cài đặt

### Prerequisites

- Rust 1.70+ ([rustup](https://rustup.rs/))
- OpenAI/Anthropic/Google API keys

### Build từ source

```bash
# Clone repo
git clone https://github.com/yourusername/quasar-agent.git
cd quasar-agent

# Build release
cargo build --release

# Binary sẽ ở target/release/quasar
```

## 🎯 Sử dụng

### 1. Setup config

```bash
# Copy example config
cp examples/quasar.example.toml quasar.toml

# Edit với API keys của bạn
nano quasar.toml
```

### 2. Chạy agent

```bash
# Start agent
cargo run --release --bin quasar -- start

# Hoặc dùng binary đã build
./target/release/quasar start
```

### 3. CLI Commands

```bash
# Setup interactively
quasar setup

# Change model
quasar model gpt-4o

# Show version
quasar version

# Custom config path
quasar --config /path/to/config.toml start
```

## 📁 Cấu trúc dự án

```
quasar-agent/
├── crates/
│   ├── quasar-core/      # Core types, errors, utilities
│   ├── quasar-agent/     # Agent loop, providers
│   ├── quasar-memory/    # SQLite + Vector DB
│   ├── quasar-tools/     # Tool implementations
│   ├── quasar-mcp/       # MCP client
│   └── quasar-cli/       # CLI binary
├── native/               # NAPI-RS native module
├── examples/             # Example configs
└── Cargo.toml           # Workspace root
```

## ⚙️ Configuration

File config: `quasar.toml` (TOML format)

```toml
[agent]
model = "gpt-4o"
thinking_level = "medium"
max_tokens = 4096

[providers.openai]
api_key = "sk-..."

[tools]
allow = ["exec", "file_read", "file_write", "web_fetch"]
exec_requires_approval = true

[memory]
sqlite_path = "./data/memory.db"
lancedb_path = "./data/lancedb"
```

Xem [examples/quasar.example.toml](examples/quasar.example.toml) để biết full config.

## 🛠️ Development

```bash
# Run tests
cargo test

# Run with logs
RUST_LOG=debug cargo run --bin quasar -- start

# Check code
cargo check --workspace

# Format
cargo fmt

# Lint
cargo clippy -- -D warnings

# Build docs
cargo doc --open
```

## 📊 Performance

So sánh với TypeScript version:

| Metric | TypeScript | Rust |
|--------|-----------|------|
| Startup time | ~500ms | ~50ms |
| Memory usage | ~150MB | ~30MB |
| Token counting | JS heuristic | Native tiktoken |
| Concurrency | Single-thread | Multi-thread |

## 🔧 Architecture

### Agent Loop

```
User Message
    ↓
Build Context Window (token management)
    ↓
Provider.complete() [with retry + circuit breaker]
    ↓
Tool Calls? ──No──→ Return Response
    ↓ Yes
Execute Tools (parallel)
    ↓
Add Tool Results
    ↓
Loop (max 15 rounds)
```

### Provider System

- Factory pattern: `ProviderFactory::create()`
- Unified interface: `Provider::complete()`
- Auto-detect provider from model name
- Resilient: retry + circuit breaker

### Tool System

- Dynamic registration: `agent.register_tool(def, handler)`
- Async handlers: `async fn(args) -> Result<String>`
- Caching: TTL cache (5 min)
- Parallel execution: tokio tasks

## 🚧 Migration Status

Xem [RUST_MIGRATION.md](RUST_MIGRATION.md) để biết chi tiết về tiến độ chuyển đổi từ TypeScript.

**Hiện tại:**
- ✅ Core types & errors
- ✅ Agent loop
- ✅ OpenAI provider
- ✅ Context management
- ✅ Basic CLI with setup/model commands
- ✅ Default tool registration (file/read/write/edit/list, exec, web_fetch)
- 🚧 Memory layer
- 🚧 MCP client
- 📋 Telegram bot
- 📋 Web gateway

## 📚 Documentation

- [Migration Guide](RUST_MIGRATION.md)
- [API Docs](https://docs.rs/quasar-agent) (coming soon)
- [Architecture](docs/architecture.md) (coming soon)

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

## 🙏 Credits

- Original TypeScript version: [quasar-agent](https://github.com/yourusername/quasar-agent)
- Powered by: [Tokio](https://tokio.rs/), [async-openai](https://github.com/64bit/async-openai), [tiktoken-rs](https://github.com/zurawiki/tiktoken-rs)

## 📞 Support

- Issues: [GitHub Issues](https://github.com/yourusername/quasar-agent/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/quasar-agent/discussions)

---

Made with ❤️ and 🦀 by the Quasar Team
