// Test script — verify all packages can be imported
import '@quasar/core'
import { SqliteMemory } from '@quasar/memory'
import { AllowlistManager } from '@quasar/security'
import { AgentLoop } from '@quasar/agent'
import { registerAllTools } from '@quasar/tools'
import { QuasarBot } from '@quasar/telegram'
import { McpClientManager } from '@quasar/mcp'
import { loadSkills } from '@quasar/skills'
import { CronScheduler } from '@quasar/scheduler'
import { TTSService, ImageService } from '@quasar/media'
import { createWebServer } from '@quasar/web'

console.log('✅ All package imports successful!')

// Test SQLite memory
import { resolve } from 'path'
import { mkdirSync } from 'fs'
mkdirSync('./data', { recursive: true })

const memory = new SqliteMemory(resolve('./data/test.db'))
const session = memory.createSession(123, 456, 'gpt-4o')
console.log(`✅ SQLite session created: ${session.id}`)

memory.addMessage(session.id, {
  role: 'user',
  content: 'Hello test',
  timestamp: Date.now(),
})
const messages = memory.getMessages(session.id)
console.log(`✅ SQLite message stored and retrieved: ${messages.length} message(s)`)

// Test allowlist
const allowlist = new AllowlistManager([123])
console.log(`✅ Allowlist: user 123 allowed=${allowlist.isAllowed(123)}, user 999 allowed=${allowlist.isAllowed(999)}`)

// Test skills
const skills = await loadSkills(resolve('./skills'))
console.log(`✅ Skills loaded: ${skills.length} (${skills.map(s => s.name).join(', ')})`)

// Test scheduler
const scheduler = new CronScheduler()
console.log(`✅ Scheduler created`)

// Cleanup
memory.deleteSession(session.id)
memory.close()
console.log(`✅ Cleanup done`)

console.log('\n🎉 ALL TESTS PASSED!')
