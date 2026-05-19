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
