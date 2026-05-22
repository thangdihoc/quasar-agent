// packages/tools/src/workflow.ts
// Workflow engine (#28) — define and run multi-step automated workflows

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

const log = createLogger('tools:workflow')

export interface WorkflowStep {
  name: string
  tool: string
  args: Record<string, unknown>
  /** Use {{prev}} to reference previous step's output */
  dependsOn?: string
}

export interface WorkflowDef {
  name: string
  description: string
  steps: WorkflowStep[]
  trigger?: { type: 'manual' } | { type: 'cron'; expression: string }
}

// In-memory workflow storage
const workflows = new Map<string, WorkflowDef>()
const workflowResults = new Map<string, { status: string; outputs: Record<string, string>; lastRun: number }>()

export const defineWorkflowDef: ToolDef = {
  name: 'define_workflow',
  description: `Define a multi-step automated workflow. Each step calls a tool with arguments.
Steps run in order. Use "dependsOn" to reference previous step output.
Example: search news → summarize → send to user.`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Unique workflow name' },
      description: { type: 'string', description: 'What this workflow does' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            tool: { type: 'string', description: 'Tool name to call' },
            args: { type: 'object', description: 'Tool arguments' },
            dependsOn: { type: 'string', description: 'Step name to get input from' },
          },
          required: ['name', 'tool', 'args'],
        },
      },
    },
    required: ['name', 'description', 'steps'],
  },
}

export const runWorkflowDef: ToolDef = {
  name: 'run_workflow',
  description: 'Run a previously defined workflow by name.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Workflow name to run' },
    },
    required: ['name'],
  },
}

export const listWorkflowsDef: ToolDef = {
  name: 'list_workflows',
  description: 'List all defined workflows and their status.',
  parameters: { type: 'object', properties: {} },
}

export function createWorkflowTools(
  toolHandlers: Map<string, (args: Record<string, unknown>) => Promise<string>>,
) {
  const defineWorkflow = async (args: Record<string, unknown>): Promise<string> => {
    const name = args.name as string
    const description = args.description as string
    const steps = args.steps as WorkflowStep[]

    if (!name || !steps?.length) return 'Error: name and steps required'

    // Validate tool names
    for (const step of steps) {
      if (!toolHandlers.has(step.tool)) {
        return `Error: tool "${step.tool}" in step "${step.name}" not found. Available: ${Array.from(toolHandlers.keys()).join(', ')}`
      }
    }

    const workflow: WorkflowDef = { name, description, steps }
    workflows.set(name, workflow)

    // Save to disk
    const workflowDir = resolve('./data/workflows')
    await mkdir(workflowDir, { recursive: true })
    await writeFile(resolve(workflowDir, `${name}.json`), JSON.stringify(workflow, null, 2))

    log.info(`Workflow defined: ${name} (${steps.length} steps)`)
    return `✅ Workflow "${name}" saved with ${steps.length} steps:\n` +
      steps.map((s, i) => `  ${i + 1}. ${s.name} → ${s.tool}`).join('\n')
  }

  const runWorkflow = async (args: Record<string, unknown>): Promise<string> => {
    const name = args.name as string
    let workflow = workflows.get(name)

    // Try load from disk
    if (!workflow) {
      try {
        const raw = await readFile(resolve('./data/workflows', `${name}.json`), 'utf-8')
        workflow = JSON.parse(raw) as WorkflowDef
        workflows.set(name, workflow)
      } catch {
        return `Error: workflow "${name}" not found.`
      }
    }

    const outputs: Record<string, string> = {}
    log.info(`Running workflow: ${name}`)

    for (const step of workflow.steps) {
      const handler = toolHandlers.get(step.tool)
      if (!handler) {
        outputs[step.name] = `Error: tool ${step.tool} not available`
        continue
      }

      // Resolve {{prev}} references
      let resolvedArgs = { ...step.args }
      if (step.dependsOn && outputs[step.dependsOn]) {
        for (const [key, val] of Object.entries(resolvedArgs)) {
          if (typeof val === 'string' && val.includes('{{prev}}')) {
            resolvedArgs[key] = val.replace('{{prev}}', outputs[step.dependsOn]!)
          }
        }
      }

      try {
        const result = await handler(resolvedArgs)
        outputs[step.name] = result
        log.info(`  Step "${step.name}" completed (${result.length} chars)`)
      } catch (e) {
        outputs[step.name] = `Error: ${e instanceof Error ? e.message : String(e)}`
        log.error(`  Step "${step.name}" failed:`, e)
      }
    }

    workflowResults.set(name, { status: 'completed', outputs, lastRun: Date.now() })

    return `📋 Workflow "${name}" completed:\n\n` +
      workflow.steps.map(s => {
        const out = outputs[s.name] || '(no output)'
        const preview = out.slice(0, 200) + (out.length > 200 ? '...' : '')
        return `**${s.name}** (${s.tool}):\n${preview}`
      }).join('\n\n')
  }

  const listWorkflows = async (): Promise<string> => {
    if (workflows.size === 0) return 'No workflows defined. Use define_workflow to create one.'

    return Array.from(workflows.entries()).map(([name, wf]) => {
      const result = workflowResults.get(name)
      const lastRun = result ? new Date(result.lastRun).toLocaleString('vi-VN') : 'never'
      return `📋 **${name}**: ${wf.description}\n   Steps: ${wf.steps.length} | Last run: ${lastRun}`
    }).join('\n\n')
  }

  return { defineWorkflow, runWorkflow, listWorkflows }
}
