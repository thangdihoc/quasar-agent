// packages/tools/src/fs/write.ts

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { writeFile, readFile, readdir, stat, mkdir } from 'fs/promises'
import { dirname } from 'path'

const log = createLogger('tools:fs:write')

export const fileWriteDef: ToolDef = {
  name: 'file_write',
  description: 'Write content to a file. Creates parent directories if needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
}

export async function fileWrite(args: Record<string, unknown>): Promise<string> {
  const path = args.path as string
  const content = args.content as string
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')
    log.info(`Wrote file: ${path}`)
    return `File written successfully: ${path}`
  } catch (e) {
    return `Error writing file: ${e instanceof Error ? e.message : String(e)}`
  }
}

export const fileEditDef: ToolDef = {
  name: 'file_edit',
  description: 'Edit a file by replacing a specific string with another.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file' },
      search: { type: 'string', description: 'Exact text to find' },
      replace: { type: 'string', description: 'Text to replace with' },
    },
    required: ['path', 'search', 'replace'],
  },
}

export async function fileEdit(args: Record<string, unknown>): Promise<string> {
  const path = args.path as string
  const search = args.search as string
  const replace = args.replace as string
  try {
    let content = await readFile(path, 'utf-8')
    if (!content.includes(search)) {
      return `Error: Search text not found in file`
    }
    content = content.replace(search, replace)
    await writeFile(path, content, 'utf-8')
    log.info(`Edited file: ${path}`)
    return `File edited successfully: ${path}`
  } catch (e) {
    return `Error editing file: ${e instanceof Error ? e.message : String(e)}`
  }
}

export const fileListDef: ToolDef = {
  name: 'file_list',
  description: 'List files and directories in a path.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the directory' },
    },
    required: ['path'],
  },
}

export async function fileList(args: Record<string, unknown>): Promise<string> {
  const path = args.path as string
  try {
    const entries = await readdir(path, { withFileTypes: true })
    const lines = await Promise.all(
      entries.slice(0, 200).map(async (entry) => {
        const fullPath = `${path}/${entry.name}`
        if (entry.isDirectory()) return `📁 ${entry.name}/`
        try {
          const s = await stat(fullPath)
          const size = s.size < 1024 ? `${s.size}B` : `${(s.size / 1024).toFixed(1)}KB`
          return `📄 ${entry.name} (${size})`
        } catch {
          return `📄 ${entry.name}`
        }
      })
    )
    return lines.join('\n') || '(empty directory)'
  } catch (e) {
    return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`
  }
}
