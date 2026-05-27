// packages/memory/src/lancedb.ts
// LanceDB vector memory — optional dependency

import { createLogger, MemoryError } from '@quasar/core'
import { randomUUID } from 'crypto'

const log = createLogger('memory:lancedb')

export interface VectorDocument {
  id: string
  text: string
  metadata: Record<string, unknown>
  vector?: number[]
  score?: number
}

export class LanceDBMemory {
  private db: any = null
  private table: any = null
  private embeddingFunc: (text: string) => Promise<number[]>

  constructor(
    private dbPath: string,
    embeddingFunc: (text: string) => Promise<number[]>,
  ) {
    this.embeddingFunc = embeddingFunc
    log.info(`LanceDB will initialize at ${dbPath}`)
  }

  async init(): Promise<void> {
    try {
      // @ts-ignore — lancedb types may not be installed
      const lancedb = await import('@lancedb/lancedb')
      this.db = await lancedb.connect(this.dbPath)
      const tables = await this.db.tableNames()
      if (tables.includes('memories')) {
        this.table = await this.db.openTable('memories')
      }
      log.info('LanceDB initialized')
    } catch (e) {
      throw new MemoryError('Failed to init LanceDB. Install: pnpm add @lancedb/lancedb', e)
    }
  }

  async add(text: string, metadata: Record<string, unknown> = {}): Promise<string> {
    if (!this.db) throw new MemoryError('LanceDB not initialized')
    const id = randomUUID()
    const vector = await this.embeddingFunc(text)
    const doc = { id, text, metadata: JSON.stringify(metadata), vector }

    if (!this.table) {
      this.table = await this.db.createTable('memories', [doc])
    } else {
      await this.table.add([doc])
    }

    // Write to Obsidian-style memories.md markdown file
    try {
      const { appendFile, mkdir } = await import('fs/promises')
      const { join, dirname } = await import('path')
      const mdPath = join(this.dbPath, '../memory/memories.md')
      await mkdir(dirname(mdPath), { recursive: true })
      const timestamp = metadata.timestamp || new Date().toISOString()
      const category = metadata.category || 'general'
      const mdContent = `\n## ${timestamp} [${category}]\n- ${text}\n`
      await appendFile(mdPath, mdContent, 'utf-8')
      log.info(`Appended memory to Markdown file: ${mdPath}`)
    } catch (err) {
      log.error('Failed to append memory to Markdown file:', err)
    }

    log.info(`Added memory: ${id} (${text.slice(0, 50)}...)`)
    return id
  }

  async search(query: string, limit = 5): Promise<VectorDocument[]> {
    if (!this.table) return []

    try {
      const vector = await this.embeddingFunc(query)
      const results = await this.table.search(vector).limit(limit).toArray()

      return results.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        text: r.text as string,
        metadata: JSON.parse((r.metadata as string) || '{}'),
        score: r._distance as number | undefined
      }))
    } catch (e) {
      log.error('Search failed:', e)
      return []
    }
  }
}
