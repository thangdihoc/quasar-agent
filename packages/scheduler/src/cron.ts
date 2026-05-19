// packages/scheduler/src/cron.ts

import cron from 'node-cron'
import { createLogger } from '@quasar/core'

const log = createLogger('scheduler:cron')

interface ScheduledTask {
  id: string
  expression: string
  description: string
  task: cron.ScheduledTask
}

export class CronScheduler {
  private tasks = new Map<string, ScheduledTask>()

  schedule(id: string, expression: string, description: string, callback: () => void | Promise<void>): boolean {
    if (!cron.validate(expression)) {
      log.error(`Invalid cron expression: ${expression}`)
      return false
    }

    // Remove existing task with same id
    this.cancel(id)

    const task = cron.schedule(expression, async () => {
      log.info(`Running task: ${id} (${description})`)
      try {
        await callback()
      } catch (e) {
        log.error(`Task ${id} failed:`, e)
      }
    })

    this.tasks.set(id, { id, expression, description, task })
    log.info(`Scheduled: ${id} [${expression}] ${description}`)
    return true
  }

  cancel(id: string): boolean {
    const existing = this.tasks.get(id)
    if (existing) {
      existing.task.stop()
      this.tasks.delete(id)
      log.info(`Cancelled: ${id}`)
      return true
    }
    return false
  }

  list(): Array<{ id: string; expression: string; description: string }> {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      expression: t.expression,
      description: t.description,
    }))
  }

  stopAll(): void {
    for (const [id, t] of this.tasks) {
      t.task.stop()
    }
    this.tasks.clear()
    log.info('All tasks stopped')
  }
}
