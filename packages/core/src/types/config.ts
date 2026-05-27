// packages/core/src/types/config.ts
import type { ProviderName } from './agent.js'

export interface GatewayConfig {
  port: number
  host: string
}

export interface AgentCoreConfig {
  model: string
  thinkingLevel: 'low' | 'medium' | 'high'
  maxTokens: number
  systemPrompt?: string
}

export interface TelegramConfig {
  token: string
  allowedUsers: number[]
}

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
}

export interface ToolsConfig {
  allow: string[]
  deny: string[]
  execRequiresApproval: boolean
}

export interface MemoryConfig {
  sqlitePath: string
  lancedbPath: string
}

export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface ComputerUseConfig {
  enabled: boolean
  pythonPort: number
  provider?: string
  model?: string
}

export interface WebConfig {
  apiKey?: string
}

// --- OpenClaw-inspired configs ---

export interface SoulConfig {
  soulPath: string         // default: './data/SOUL.md'
  identityPath: string     // default: './data/IDENTITY.md'
  userProfilePath: string  // default: './data/USER_PROFILE.md'
}

export interface HeartbeatConfig {
  enabled: boolean
  intervalMinutes: number       // default: 30
  quietHoursStart: number       // default: 23 (11PM)
  quietHoursEnd: number         // default: 8 (8AM)
  checklistPath: string         // default: './data/HEARTBEAT.md'
  statePath: string             // default: './data/heartbeat-state.json'
}

export interface EtiquetteConfig {
  enabled: boolean
  maxConsecutiveReplies: number  // default: 2
  respondWhen: ('mentioned' | 'question' | 'valuable_info' | 'correction')[]
  silentWhen: ('casual_banter' | 'already_answered' | 'low_value')[]
}

export interface QuasarConfig {
  gateway: GatewayConfig
  agent: AgentCoreConfig
  telegram: TelegramConfig
  providers: Partial<Record<ProviderName, ProviderConfig>>
  tools: ToolsConfig
  memory: MemoryConfig
  mcp?: { servers: McpServerConfig[] }
  computerUse?: ComputerUseConfig
  web?: WebConfig
  soul?: SoulConfig
  heartbeat?: HeartbeatConfig
  etiquette?: EtiquetteConfig
}
