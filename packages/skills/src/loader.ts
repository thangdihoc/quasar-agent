// packages/skills/src/loader.ts

import { readdir, readFile } from 'fs/promises'
import { resolve, extname } from 'path'
import { createLogger } from '@quasar/core'

const log = createLogger('skills:loader')

export interface Skill {
  name: string
  content: string
}

export async function loadSkills(skillsDir: string): Promise<Skill[]> {
  const skills: Skill[] = []

  try {
    const files = await readdir(skillsDir)

    for (const file of files) {
      if (extname(file) !== '.md') continue
      const name = file.replace('.md', '')
      const content = await readFile(resolve(skillsDir, file), 'utf-8')
      skills.push({ name, content })
      log.info(`Loaded skill: ${name}`)
    }

    log.info(`${skills.length} skills loaded from ${skillsDir}`)
  } catch (e) {
    log.warn(`Skills directory not found: ${skillsDir}`)
  }

  return skills
}

export function skillsToPrompt(skills: Skill[]): string {
  if (skills.length === 0) return ''

  return '\n\n## Loaded Skills\n\n' +
    skills.map(s => `### ${s.name}\n${s.content}`).join('\n\n')
}
