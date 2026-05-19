// packages/tools/src/fs/read.ts

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { readFile } from 'fs/promises'

const log = createLogger('tools:fs:read')

export const fileReadDef: ToolDef = {
  name: 'file_read',
  description: 'Read the contents of a file. Supports text files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file' },
      maxLines: { type: 'number', description: 'Max lines to read (default: all)' },
    },
    required: ['path'],
  },
}

export async function fileRead(args: Record<string, unknown>): Promise<string> {
  const path = args.path as string
  const maxLines = args.maxLines as number | undefined

  try {
    let content = await readFile(path, 'utf-8')
    if (maxLines) {
      const lines = content.split('\n')
      content = lines.slice(0, maxLines).join('\n')
      if (lines.length > maxLines) {
        content += `\n... (${lines.length - maxLines} more lines)`
      }
    }
    const truncated = content.length > 20_000
      ? content.slice(0, 20_000) + '\n... (truncated)'
      : content
    log.info(`Read file: ${path} (${truncated.length} chars)`)
    return truncated
  } catch (e) {
    return `Error reading file: ${e instanceof Error ? e.message : String(e)}`
  }
}
