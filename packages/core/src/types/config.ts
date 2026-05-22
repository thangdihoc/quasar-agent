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
}

export interface WebConfig {
  apiKey?: string
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
}
