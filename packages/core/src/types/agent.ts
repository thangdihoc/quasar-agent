// packages/core/src/types/agent.ts

export type ThinkingLevel = 'low' | 'medium' | 'high'
export type ProviderName = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'ollama'

export interface AgentConfig {
  model: string
  provider?: ProviderName
  thinkingLevel: ThinkingLevel
  maxTokens: number
  systemPrompt?: string
  temperature?: number
}

export interface AgentState {
  isProcessing: boolean
  currentModel: string
  currentProvider: ProviderName
  totalTokensUsed: number
  messagesProcessed: number
}
