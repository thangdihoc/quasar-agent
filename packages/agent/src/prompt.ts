// packages/agent/src/prompt.ts
// Smart Context Injection (#18)

import type { QuasarConfig } from '@quasar/core'
import { hostname, platform, arch, totalmem } from 'os'

const DEFAULT_SYSTEM_PROMPT = `You are Quasar, a powerful personal AI assistant running on the user's Windows machine.
You have access to tools that let you execute commands, read/write files, search the web, and more.

Key behaviors:
- Be concise and direct
- Use tools proactively when they help
- Always explain what you're doing before executing dangerous commands
- Format responses in markdown when helpful
- If a task requires multiple steps, plan first then execute
- When executing PowerShell commands, prefer non-destructive operations
- If you're unsure about something, ask the user

Current capabilities:
- Execute PowerShell commands on the user's machine
- Read, write, and edit files
- Search the web and fetch URLs
- Read PDF documents
- Generate images and audio (when configured)
- Schedule tasks with cron expressions
- Connect to MCP servers for additional tools
- Remember information long-term (RAG memory)
- Control computer screen (Computer Use)`

export function buildSystemPrompt(config: QuasarConfig, extraContext?: string): string {
  let prompt = config.agent.systemPrompt || DEFAULT_SYSTEM_PROMPT

  // Smart Context Injection (#18) — dynamic system info
  const now = new Date()
  const contextBlock = [
    '',
    '## Current Context',
    `- Date/Time: ${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN')}`,
    `- Day: ${['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'][now.getDay()]}`,
    `- System: ${platform()} ${arch()} (${hostname()})`,
    `- Memory: ${Math.round(totalmem() / 1024 / 1024 / 1024)}GB RAM`,
    `- Node.js: ${process.version}`,
  ].join('\n')

  prompt += contextBlock

  if (extraContext) {
    prompt += `\n\n${extraContext}`
  }

  return prompt
}
