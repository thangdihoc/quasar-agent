// packages/tools/src/sandbox.ts
// Code Interpreter Sandbox (#27)
// Chạy code trong subprocess cô lập với timeout

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { spawn } from 'child_process'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { resolve } from 'path'
import { randomUUID } from 'crypto'

const log = createLogger('tools:sandbox')

function getCleanEnv(): Record<string, string> {
  const cleanEnv: Record<string, string> = {}
  
  const safeKeys = new Set([
    'path',
    'appdata',
    'localappdata',
    'userprofile',
    'systemroot',
    'systemdrive',
    'temp',
    'tmp',
    'os',
    'number_of_processors',
    'processor_identifier',
    'processor_level',
    'processor_revision',
    'pathext',
    'homedrive',
    'homepath',
    'programfiles',
    'programfiles(x86)',
    'programdata',
    'commonprogramfiles',
    'commonprogramfiles(x86)',
    'lang',
    'lc_all',
  ])

  const sensitiveKeywords = [
    'api', 'key', 'secret', 'password', 'token', 'credentials', 'auth',
    'gemini', 'openai', 'anthropic', 'telegram', 'cohere', 'openrouter', 'ollama'
  ]

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue
    const keyLower = key.toLowerCase()
    
    // Check if it is in the whitelist of safe keys
    if (safeKeys.has(keyLower)) {
      // Double check that it does not contain sensitive keywords
      const hasSensitiveKeyword = sensitiveKeywords.some(kw => keyLower.includes(kw))
      if (!hasSensitiveKeyword) {
        cleanEnv[key] = value
      }
    }
  }

  return cleanEnv
}

export const runCodeDef: ToolDef = {
  name: 'run_code',
  description: `Execute code in a sandboxed subprocess. Supports Python and Node.js.
Returns stdout, stderr, and exit code. Timeout: 30 seconds.
Use this for calculations, data processing, or testing code snippets safely.`,
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: ['python', 'javascript', 'typescript'],
        description: 'Programming language',
      },
      code: {
        type: 'string',
        description: 'Code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 30, max: 60)',
      },
    },
    required: ['language', 'code'],
  },
}

export function createRunCodeTool(): (args: Record<string, unknown>) => Promise<string> {
  return async (args: Record<string, unknown>): Promise<string> => {
    const language = args.language as string
    const code = args.code as string
    const timeout = Math.min((args.timeout as number) || 30, 60) * 1000

    if (!code) return 'Error: code is required'

    const tempDir = resolve('./data/sandbox')
    await mkdir(tempDir, { recursive: true })

    const fileId = randomUUID().slice(0, 8)
    let filePath: string
    let command: string
    let cmdArgs: string[]

    switch (language) {
      case 'python': {
        filePath = resolve(tempDir, `${fileId}.py`)
        command = 'python'
        cmdArgs = [filePath]
        break
      }
      case 'javascript': {
        filePath = resolve(tempDir, `${fileId}.mjs`)
        command = 'node'
        cmdArgs = [filePath]
        break
      }
      case 'typescript': {
        filePath = resolve(tempDir, `${fileId}.ts`)
        command = 'npx'
        cmdArgs = ['tsx', filePath]
        break
      }
      default:
        return `Error: Unsupported language "${language}". Use python, javascript, or typescript.`
    }

    await writeFile(filePath, code)

    try {
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const cleanEnv = getCleanEnv()
        const proc = spawn(command, cmdArgs, {
          timeout,
          cwd: tempDir,
          env: {
            ...cleanEnv,
            // Restrict some things
            NODE_OPTIONS: '--max-old-space-size=256',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => { stdout += data.toString() })
        proc.stderr.on('data', (data) => { stderr += data.toString() })

        proc.on('close', (code) => {
          resolve({ stdout, stderr, exitCode: code ?? 0 })
        })

        proc.on('error', (err) => {
          resolve({ stdout, stderr: err.message, exitCode: 1 })
        })

        // Close stdin immediately
        proc.stdin.end()
      })

      // Cleanup temp file
      try { await unlink(filePath) } catch { /* ignore */ }

      const parts: string[] = []
      if (result.stdout) parts.push(`📤 Output:\n${result.stdout.slice(0, 5000)}`)
      if (result.stderr) parts.push(`⚠️ Stderr:\n${result.stderr.slice(0, 2000)}`)
      parts.push(`Exit code: ${result.exitCode}`)

      if (result.stdout.length > 5000) parts.push(`(output truncated, ${result.stdout.length} chars total)`)

      log.info(`Code executed (${language}): exit=${result.exitCode}, stdout=${result.stdout.length}chars`)
      return parts.join('\n\n')
    } catch (e) {
      try { await unlink(filePath) } catch { /* ignore */ }
      return `Error executing code: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
