# 🚀 Quasar — Rust-first AI Agent

> Rust là lõi chính của Quasar. TypeScript/Python hiện đã được tách sang `legacy/` và chỉ giữ lại để tham khảo.
>
> Xem `README_RUST.md` để chạy phiên bản native Rust. `legacy/` chứa code TS/Python cũ và không phải phần của luồng runtime chính.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Core runtime | Rust |
| Native helpers | Rust (napi-rs) |
| Legacy support | TypeScript + Python (moved to `legacy/`) |
| Database | SQLite + LanceDB |

> `crates/` chứa Rust core runtime. Legacy TypeScript/Python sources đã được chuyển vào `legacy/`.

## Quick Start (Rust-first)

```bash
# 1. Clone
git clone https://github.com/thangdihoc/quasar-agent.git
cd quasar-agent

# 2. Build Rust workspace
cargo build --release

# 3. Create config
cargo run --bin quasar -- setup
# Edit quasar.toml, add provider keys and optional tool settings

# 4. Start the Rust agent
cargo run --bin quasar -- start
```

> Note: `crates/` là lõi chính. Legacy TypeScript/Python code đã được chuyển vào `legacy/` và không còn nằm trong luồng runtime chính.

## Features

- 🤖 **5 AI Providers** — OpenAI, Claude, Gemini, OpenRouter, Ollama
- 🦀 **Rust-first runtime** — core agent loop, provider integration, tool execution
- 💬 **Telegram Bot** — optional UI/bot layer in TypeScript (legacy/)
- 🌐 **Web UI** — optional frontend layer in TypeScript (legacy/)
- 🛠️ **Tools** — PowerShell, file ops, web search, PDF
- 🧠 **Memory** — SQLite (sessions) + LanceDB (vectors)
- 🔌 **MCP** — Model Context Protocol support
- 🔒 **Security** — User allowlist, exec approval
- 🎨 **Media** — TTS, image generation (DALL-E 3)
- ⏰ **Scheduler** — Cron task automation
- 🖥️ **Computer Use** — Python automation support (legacy/)
- 🧩 **Integration** — Rust core + legacy TS/Python support

## Commands

| Command | Description |
|---------|-------------|
| `cargo run --bin quasar -- start` | Start the Rust agent |
| `cargo run --bin quasar -- setup` | Generate example config |
| `cargo run --bin quasar -- model gpt-4o` | Change default model |
| `cargo check --workspace` | Check all Rust crates |

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/new` | New conversation |
| `/model` | Switch AI model |
| `/status` | View status |
| `/help` | Help |

## License

MIT
