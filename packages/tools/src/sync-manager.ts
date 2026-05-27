import { promises as fs } from 'fs'
import { join } from 'path'
import { createLogger } from '@quasar/core'
import type { LanceDBMemory } from '@quasar/memory'

const log = createLogger('tools:sync-manager')

export class SyncManager {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private vectorMemory: LanceDBMemory,
    private watchDir: string,
    private intervalMs: number = 20 * 60 * 1000 // default 20 minutes
  ) {}

  start() {
    if (this.timer) return
    log.info(`SyncManager started watching: ${this.watchDir} (every ${this.intervalMs}ms)`)
    this.timer = setInterval(() => this.sync(), this.intervalMs)
    // Run initial sync
    this.sync().catch(err => log.error('Initial sync failed:', err))
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      log.info('SyncManager stopped')
    }
  }

  async sync() {
    log.info('Starting context synchronization...')
    try {
      await fs.mkdir(this.watchDir, { recursive: true })
      const files = await fs.readdir(this.watchDir)
      
      for (const file of files) {
        if (!file.endsWith('.md') && !file.endsWith('.txt')) continue
        const filePath = join(this.watchDir, file)
        const stats = await fs.stat(filePath)
        
        const content = await fs.readFile(filePath, 'utf-8')
        log.info(`Syncing file context: ${file}`)
        
        // Chunk content by paragraphs
        const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 10)
        for (const para of paragraphs) {
          await this.vectorMemory.add(para.trim(), {
            source: 'sync-manager',
            fileName: file,
            modifiedAt: stats.mtime.toISOString()
          })
        }
      }
      log.info('Context synchronization completed.')
    } catch (err) {
      log.error('Error during context sync:', err)
    }
  }
}
