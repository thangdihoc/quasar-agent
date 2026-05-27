import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { SyncManager } from '../packages/tools/src/sync-manager.js'
import { LanceDBMemory } from '../packages/memory/src/lancedb.js'
import { rm, writeFile, mkdir } from 'fs/promises'
import { resolve, join } from 'path'

describe('SyncManager Context Sync', () => {
  const testDbPath = resolve('./data/test-sync-vectors')
  const testSyncDir = resolve('./data/test-sync-dir')
  const testMdPath = resolve('./data/memory/memories.md')

  beforeAll(async () => {
    try {
      await rm(testDbPath, { recursive: true, force: true })
      await rm(testSyncDir, { recursive: true, force: true })
      await rm(testMdPath, { force: true })
      await mkdir(testSyncDir, { recursive: true })
    } catch {}
  })

  afterAll(async () => {
    try {
      await rm(testDbPath, { recursive: true, force: true })
      await rm(testSyncDir, { recursive: true, force: true })
      await rm(testMdPath, { force: true })
    } catch {}
  })

  test('should scan files and add paragraphs to memory', async () => {
    const mockEmbedding = async () => Array(1536).fill(0.1)
    const memory = new LanceDBMemory(testDbPath, mockEmbedding)
    await memory.init()

    const docPath = join(testSyncDir, 'project-info.md')
    await writeFile(docPath, 'Project Quasar is awesome.\n\nIt is designed as an agent platform.\n\nShort line', 'utf-8')

    const syncManager = new SyncManager(memory, testSyncDir, 10000)
    await syncManager.sync()

    const results = await memory.search('Quasar')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.text).toContain('Project Quasar')
  }, 30000)
})
