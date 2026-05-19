// Test web server
import { SqliteMemory } from '@quasar/memory'
import { AgentLoop } from '@quasar/agent'
import { createWebServer } from '@quasar/web'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import type { QuasarConfig } from '@quasar/core'

mkdirSync('./data', { recursive: true })
const memory = new SqliteMemory(resolve('./data/test-web.db'))

const config: QuasarConfig = {
  gateway: { port: 18789, host: '127.0.0.1' },
  agent: { model: 'gpt-4o', thinkingLevel: 'medium', maxTokens: 4096 },
  telegram: { token: 'test', allowedUsers: [] },
  providers: { openai: { apiKey: 'test' } },
  tools: { allow: [], deny: [], execRequiresApproval: true },
  memory: { sqlitePath: '', lancedbPath: '' },
}

const agent = new AgentLoop(config, memory)
createWebServer(agent, memory, 18789)

// Test health endpoint
setTimeout(async () => {
  try {
    const res = await fetch('http://127.0.0.1:18789/api/health')
    const data = await res.json()
    console.log('✅ Health endpoint:', JSON.stringify(data))

    // Test static page
    const page = await fetch('http://127.0.0.1:18789/')
    console.log(`✅ Web UI: status=${page.status}, size=${(await page.text()).length} chars`)

    console.log('\n🎉 WEB SERVER TESTS PASSED!')
    process.exit(0)
  } catch (e) {
    console.error('❌ Web test failed:', e)
    process.exit(1)
  }
}, 1000)
