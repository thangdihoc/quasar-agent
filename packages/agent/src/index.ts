// packages/agent/src/index.ts
export { AgentLoop } from './loop.js'
export { buildSystemPrompt } from './prompt.js'
export { createProvider, detectProvider, stripModelPrefix } from './providers/index.js'
export {
  buildContextWindow,
  compactMessages,
  estimateTokens,
  truncateToolOutput,
} from './context.js'
export type { IProvider } from './providers/index.js'
export type { CompletionOptions, CompletionResult } from './providers/openai.js'
export { delegateTaskDef, listAgentsDef, createDelegationTools, SUB_AGENTS, type SubAgentProfile } from './delegation.js'
export { HeartbeatEngine, getDefaultHeartbeatConfig, type HeartbeatState, type HeartbeatResult } from './heartbeat.js'
export { ChatEtiquette, getDefaultEtiquetteConfig, type ChatContext, type EtiquetteDecision } from './chat-etiquette.js'

