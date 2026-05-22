// packages/tools/src/scheduler.ts

import type { ToolDef } from '@quasar/core'
import { createLogger } from '@quasar/core'
import type { CronScheduler } from '@quasar/scheduler'

const log = createLogger('tools:scheduler')

export const scheduleTaskDef: ToolDef = {
  name: 'schedule_task',
  description: 'Schedule a recurring agent task using a cron expression.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Unique identifier for the scheduled task' },
      expression: { type: 'string', description: 'Cron expression (e.g. "0 9 * * *" for daily at 9am, "*/15 * * * *" for every 15m)' },
      description: { type: 'string', description: 'Description of what the task does' },
      prompt: { type: 'string', description: 'The prompt instructions to run when this task fires (e.g. "Kiểm tra thời tiết hôm nay")' }
    },
    required: ['id', 'expression', 'description', 'prompt']
  }
}

export function createScheduleTaskTool(
  scheduler?: CronScheduler,
  onTaskTrigger?: (id: string, prompt: string, description: string) => void | Promise<void>
) {
  return async (args: Record<string, unknown>): Promise<string> => {
    if (!scheduler) {
      return 'Error: Scheduler service is not available.'
    }
    const id = args.id as string
    const expression = args.expression as string
    const description = args.description as string
    const prompt = args.prompt as string

    try {
      const success = scheduler.schedule(id, expression, description, async () => {
        log.info(`Scheduled task ${id} triggered!`)
        if (onTaskTrigger) {
          await onTaskTrigger(id, prompt, description)
        }
      })

      if (success) {
        return `Successfully scheduled task "${id}" using cron "${expression}".`
      } else {
        return `Failed to schedule task "${id}". Please verify the cron expression is valid.`
      }
    } catch (e) {
      log.error(`schedule_task failed for ${id}:`, e)
      return `Error scheduling task: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

export const cancelTaskDef: ToolDef = {
  name: 'cancel_task',
  description: 'Cancel an active scheduled task.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The ID of the scheduled task to cancel' }
    },
    required: ['id']
  }
}

export function createCancelTaskTool(scheduler?: CronScheduler) {
  return async (args: Record<string, unknown>): Promise<string> => {
    if (!scheduler) {
      return 'Error: Scheduler service is not available.'
    }
    const id = args.id as string

    try {
      const cancelled = scheduler.cancel(id)
      if (cancelled) {
        return `Successfully cancelled scheduled task "${id}".`
      } else {
        return `Scheduled task "${id}" was not found or already completed/cancelled.`
      }
    } catch (e) {
      log.error(`cancel_task failed for ${id}:`, e)
      return `Error cancelling task: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
