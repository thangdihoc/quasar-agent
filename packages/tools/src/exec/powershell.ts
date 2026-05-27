import { createLogger, ToolError } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { AllowlistManager } from '@quasar/security'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { platform } from 'os'

const log = createLogger('tools:exec')

export const execDef: ToolDef = {
  name: 'exec',
  description: 'Execute a terminal/shell command on the user\'s machine. Uses PowerShell on Windows and Bash on macOS/Linux. Use this for system operations, file management, running scripts, installing software, etc. Always explain what the command does before running it.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute (PowerShell format on Windows, Bash on macOS/Linux)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },
}

export function createExecTool(
  allowlist: AllowlistManager,
  onApprovalNeeded?: (id: string, command: string) => Promise<void>
) {
  return async (args: Record<string, unknown>): Promise<string> => {
    const command = args.command as string
    const timeout = (args.timeout as number) || 30_000

    if (!command) throw new ToolError('Command is required')

    // Check approval
    const approvalId = randomUUID()
    if (onApprovalNeeded) {
      await onApprovalNeeded(approvalId, command)
      const approved = await allowlist.requestApproval(approvalId, command, 60_000)
      if (!approved) {
        return 'Command was denied or timed out.'
      }
    }

    log.info(`Executing: ${command}`)

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      const isWin = platform() === 'win32'
      const shellCmd = isWin ? 'powershell.exe' : 'bash'
      const shellArgs = isWin 
        ? ['-NoProfile', '-NonInteractive', '-Command', command]
        : ['-c', command]

      const proc = spawn(shellCmd, shellArgs, {
        timeout,
        windowsHide: true,
      })

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

      proc.on('close', (code) => {
        const output = stdout.trim() || stderr.trim()
        const truncated = output.length > 10_000 ? output.slice(0, 10_000) + '\n... (truncated)' : output
        resolve(`Exit code: ${code}\n${truncated}`)
      })

      proc.on('error', (err) => {
        resolve(`Error: ${err.message}`)
      })
    })
  }
}
