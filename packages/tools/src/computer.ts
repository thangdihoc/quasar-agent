// packages/tools/src/computer.ts

import type { ToolDef } from '@quasar/core'
import { createLogger } from '@quasar/core'

const log = createLogger('tools:computer')

export const computerUseDef: ToolDef = {
  name: 'computer_use',
  description: 'Control the computer GUI (screen, mouse, keyboard) using AI vision to complete a specific task.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The task description for the computer agent (e.g. "open notepad and type hello world")' },
      maxSteps: { type: 'number', description: 'Max execution steps (default: 20)' },
      provider: { type: 'string', description: 'API provider to use (e.g. "anthropic", "google", "openrouter", "openai")' },
      model: { type: 'string', description: 'Model ID to use (e.g. "claude-3-5-sonnet-latest", "gpt-4o-mini", "gemini-2.5-flash", etc.)' }
    },
    required: ['task']
  }
}

export function createComputerUseTool(
  pythonPort = 18790,
  anthropicApiKey?: string,
  googleApiKey?: string,
  openrouterApiKey?: string,
  openaiApiKey?: string,
  defaultProvider?: string,
  defaultModel?: string
) {
  return async (args: Record<string, unknown>): Promise<string> => {
    const task = args.task as string
    const maxSteps = (args.maxSteps as number) || 20
    const provider = (args.provider as string) || defaultProvider
    const model = (args.model as string) || defaultModel

    try {
      log.info(`Sending computer_use task: "${task}" (maxSteps: ${maxSteps}, provider: ${provider || 'auto'}, model: ${model || 'default'})`)
      const res = await fetch(`http://127.0.0.1:${pythonPort}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          max_steps: maxSteps,
          api_key: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
          google_api_key: googleApiKey || process.env.GOOGLE_API_KEY,
          openrouter_api_key: openrouterApiKey || process.env.OPENROUTER_API_KEY,
          openai_api_key: openaiApiKey || process.env.OPENAI_API_KEY,
          provider,
          model
        })
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to execute computer task. Python server returned: ${res.status} - ${errText}`
      }

      const result = await res.json() as { success: boolean; steps: number; message: string; screenshots?: string[] }
      if (result.success) {
        return `Computer task completed successfully in ${result.steps} steps. Message: ${result.message}`
      } else {
        return `Computer task failed or reached step limit after ${result.steps} steps. Message: ${result.message}`
      }
    } catch (e) {
      log.error('computer_use failed:', e)
      return `Failed to contact Computer Use server on port ${pythonPort}. Make sure python server is running. Error: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
