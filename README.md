# 🚀 Quasar — Personal AI Agent

> AI Agent cá nhân chạy trên Windows, giao tiếp qua Telegram và Web UI.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Core | TypeScript |
| Native | Rust (napi-rs) |
| Computer Use | Python (FastAPI) |
| Package Manager | pnpm (monorepo) |
| Database | SQLite + LanceDB |

## Quick Start

```bash
# 1. Clone
git clone https://github.com/thangdihoc/quasar-agent.git
cd quasar-agent

# 2. Install
pnpm install

# 3. Configure
cp .env.example .env
# Edit .env → add TELEGRAM_BOT_TOKEN and API keys

# 4. Health check
pnpm doctor

# 5. Start
pnpm start
```

## Features

- 🤖 **5 AI Providers** — OpenAI, Claude, Gemini, OpenRouter, Ollama
- 💬 **Telegram Bot** — Chat, commands, model switching
- 🌐 **Web UI** — Dark mode chat interface
- 🛠️ **Tools** — PowerShell, file ops, web search, PDF
- 🧠 **Memory** — SQLite (sessions) + LanceDB (vectors)
- 🔌 **MCP** — Model Context Protocol support
- 🔒 **Security** — User allowlist, exec approval
- 🎨 **Media** — TTS, image generation (DALL-E 3)
- ⏰ **Scheduler** — Cron task automation
- 🖥️ **Computer Use** — Screen control via Python (Claude Vision)
- 🦀 **Rust Native** — Fast token counting, diff

## Commands

| Command | Description |
|---------|-------------|
| `pnpm start` | Start the agent |
| `pnpm dev` | Start with auto-reload |
| `pnpm doctor` | Run health check |
| `pnpm typecheck` | Check TypeScript |

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
