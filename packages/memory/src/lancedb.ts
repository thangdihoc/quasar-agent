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
      }))
    } catch (e) {
      log.error('Search failed:', e)
      return []
    }
  }
}
