import { createProvider, detectProvider } from '../packages/agent/src/providers/index.js'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env manually
const envPath = resolve('.env')
const envVars: Record<string, string> = {}
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      const k = trimmed.substring(0, idx).trim()
      const v = trimmed.substring(idx + 1).trim()
      envVars[k] = v
    }
  }
}
process.env.GOOGLE_API_KEY = envVars.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY

async function test() {
  const model = 'gemini-2.5-flash-lite'
  const providerName = detectProvider(model)
  console.log(`Detected provider: ${providerName}`)

  const provider = createProvider(providerName, {
    providers: {
      google: { apiKey: process.env.GOOGLE_API_KEY }
    }
  } as any)

  const result = await provider.complete({
    model,
    systemPrompt: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Say hello in Vietnamese.' }],
    tools: [],
    stream: false
  })

  console.log('Result:', result)
}

test().catch(console.error)
