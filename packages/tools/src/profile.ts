// packages/tools/src/profile.ts

import type { ToolDef } from '@quasar/core'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { createLogger } from '@quasar/core'

const log = createLogger('tools:profile')

export const updateUserProfileDef: ToolDef = {
  name: 'update_user_profile',
  description: 'Update the user profile file (USER_PROFILE.md) with new preferences, habits, or programming rules learned from conversations.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The preference or topic to update (e.g. "programming_language", "work_hours", "coding_style")' },
      value: { type: 'string', description: 'The details or value for this preference (e.g. "Prefers TypeScript and React without verbose comments")' }
    },
    required: ['key', 'value']
  }
}

export function createUpdateUserProfileTool() {
  return async (args: Record<string, unknown>): Promise<string> => {
    const key = (args.key as string).trim()
    const value = (args.value as string).trim()
    const filePath = resolve('./data/USER_PROFILE.md')

    try {
      let content = ''
      if (existsSync(filePath)) {
        content = await readFile(filePath, 'utf-8')
      } else {
        content = '# Quasar User Profile\n\nThông tin và sở thích của người dùng được tự động lưu trữ tại đây.\n\n## Preferences\n'
      }

      const lines = content.split('\n')
      const targetPrefix = `- **${key}**:`
      let found = false

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim()
        if (line.startsWith(targetPrefix)) {
          lines[i] = `- **${key}**: ${value}`
          found = true
          break
        }
      }

      if (!found) {
        const prefIndex = lines.findIndex(l => l.trim().startsWith('## Preferences'))
        if (prefIndex !== -1) {
          lines.splice(prefIndex + 1, 0, `- **${key}**: ${value}`)
        } else {
          lines.push(`- **${key}**: ${value}`)
        }
      }

      await writeFile(filePath, lines.join('\n'), 'utf-8')
      log.info(`Updated user profile: ${key} = ${value}`)
      return `Successfully updated user profile preference for "${key}".`
    } catch (e) {
      log.error('Failed to update user profile:', e)
      return `Error updating user profile: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
