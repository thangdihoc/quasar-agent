// packages/tools/src/daily-notes.ts
// Daily Memory Notes (OpenClaw concept)
// Raw journal entries: data/memory/YYYY-MM-DD.md

import type { ToolDef } from '@quasar/core'
import { createLogger } from '@quasar/core'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

const log = createLogger('tools:daily-notes')

const MEMORY_DIR = './data/memory'

function getTodayFilePath(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return resolve(MEMORY_DIR, `${yyyy}-${mm}-${dd}.md`)
}

function getTimeString(): string {
  const now = new Date()
  return now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// --- Tool definitions ---

export const writeDailyNoteDef: ToolDef = {
  name: 'write_daily_note',
  description: 'Write a note to today\'s daily log file (data/memory/YYYY-MM-DD.md). Use for capturing decisions, lessons learned, important observations, or task progress.',
  parameters: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'The note content to append',
      },
      category: {
        type: 'string',
        enum: ['decision', 'learning', 'task', 'observation', 'error', 'idea'],
        description: 'Category of the note (optional, defaults to observation)',
      },
    },
    required: ['note'],
  },
}

export const readDailyNotesDef: ToolDef = {
  name: 'read_daily_notes',
  description: 'Read today\'s daily notes or a specific date\'s notes.',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD format (optional, defaults to today)',
      },
    },
  },
}

// --- Category emoji mapping ---

const CATEGORY_EMOJI: Record<string, string> = {
  decision: '🔵',
  learning: '📚',
  task: '✅',
  observation: '👁️',
  error: '❌',
  idea: '💡',
}

// --- Tool implementations ---

export function createWriteDailyNoteTool() {
  return async (args: Record<string, unknown>): Promise<string> => {
    const note = (args.note as string).trim()
    const category = (args.category as string) || 'observation'
    const emoji = CATEGORY_EMOJI[category] || '📝'

    const filePath = getTodayFilePath()
    const time = getTimeString()

    try {
      // Ensure memory directory exists
      const memDir = resolve(MEMORY_DIR)
      if (!existsSync(memDir)) {
        await mkdir(memDir, { recursive: true })
      }

      let content = ''
      if (existsSync(filePath)) {
        content = await readFile(filePath, 'utf-8')
      } else {
        // Create new daily file with header
        const now = new Date()
        const dateStr = now.toLocaleDateString('vi-VN', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
        content = `# Daily Notes — ${dateStr}\n\n`
      }

      // Append note
      const entry = `- ${emoji} **[${time}]** ${note}\n`
      content += entry

      await writeFile(filePath, content, 'utf-8')
      log.info(`Daily note added: [${category}] ${note.slice(0, 50)}`)
      return `Note added to today's log (${category}).`
    } catch (e) {
      log.error('Failed to write daily note:', e)
      return `Error writing daily note: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

export function createReadDailyNotesTool() {
  return async (args: Record<string, unknown>): Promise<string> => {
    const date = args.date as string | undefined
    let filePath: string

    if (date) {
      filePath = resolve(MEMORY_DIR, `${date}.md`)
    } else {
      filePath = getTodayFilePath()
    }

    try {
      if (!existsSync(filePath)) {
        return `No daily notes found for ${date || 'today'}.`
      }
      const content = await readFile(filePath, 'utf-8')
      return content
    } catch (e) {
      log.error('Failed to read daily notes:', e)
      return `Error reading daily notes: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
