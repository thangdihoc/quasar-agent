import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { LanceDBMemory } from '../packages/memory/src/lancedb.js'
import { rm, readFile, access } from 'fs/promises'
import { resolve } from 'path'

describe('LanceDBMemory Markdown Sync', () => {
  const testDbPath = resolve('./data/test-vectors')
  const testMdPath = resolve('./data/memory/memories.md')

  beforeAll(async () => {
    try {
      await rm(testDbPath, { recursive: true, force: true })
      await rm(testMdPath, { force: true })
    } catch {}
  })

  afterAll(async () => {
    try {
      await rm(testDbPath, { recursive: true, force: true })
      await rm(testMdPath, { force: true })
    } catch {}
  })

  test('should append markdown memories when adding to LanceDB', async () => {
    const mockEmbedding = async () => Array(1536).fill(0.1)

    const memory = new LanceDBMemory(testDbPath, mockEmbedding)
    await memory.init()

    const textToRemember = 'User likes tea over coffee'
    await memory.add(textToRemember, { category: 'preferences', timestamp: '2026-05-26T12:00:00Z' })

    const fileExists = await access(testMdPath).then(() => true).catch(() => false)
    expect(fileExists).toBe(true)

    const content = await readFile(testMdPath, 'utf8')
    expect(content).toContain('## 2026-05-26T12:00:00Z [preferences]')
    expect(content).toContain('- User likes tea over coffee')
  }, 60000)
})
