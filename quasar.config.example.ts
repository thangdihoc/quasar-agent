// quasar.config.example.ts
// Copy this file to quasar.config.ts and customize

import type { QuasarConfig } from '@quasar/core'

/**
 * Quasar Agent Configuration
 *
 * Export default object or function that receives the base config.
 * Values defined here will be deep-merged with defaults from .env
 */
export default {
  // Override agent settings
  agent: {
    // model: 'claude-3-5-sonnet-latest',
    // maxTokens: 16384,
    // systemPrompt: 'Custom system prompt here...',
  },

  // Override tool settings
  tools: {
    // allow: ['exec', 'file_read', 'web_search'],
    // deny: ['computer_use'],
    // execRequiresApproval: true,
  },

  // Web UI settings
  web: {
    // apiKey: 'your-secret-key',  // Protect web UI with API key
  },

  // Gateway (web server)
  gateway: {
    // port: 18789,
    // host: '127.0.0.1',
  },
} satisfies Partial<QuasarConfig & { web: { apiKey: string } }>
