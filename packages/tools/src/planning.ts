// packages/tools/src/planning.ts
// Multi-step Planning tool (#13) — AI can create and track plans

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'

const log = createLogger('tools:planning')

// In-memory plan storage (per session)
const activePlans = new Map<string, {
  goal: string
  steps: Array<{ description: string; status: 'pending' | 'in_progress' | 'done' | 'failed' }>
  createdAt: number
}>()

export const createPlanDef: ToolDef = {
  name: 'create_plan',
  description: 'Create a step-by-step plan to accomplish a complex goal. Use this when a task requires multiple steps. The plan will be tracked and you can update step status as you progress.',
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'The overall goal or task to accomplish',
      },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of step descriptions in order',
      },
    },
    required: ['goal', 'steps'],
  },
}

export const updatePlanDef: ToolDef = {
  name: 'update_plan',
  description: 'Update the status of a step in the current plan. Use after completing or starting a step.',
  parameters: {
    type: 'object',
    properties: {
      step_index: {
        type: 'number',
        description: 'Index of the step to update (0-based)',
      },
      status: {
        type: 'string',
        enum: ['in_progress', 'done', 'failed'],
        description: 'New status for the step',
      },
    },
    required: ['step_index', 'status'],
  },
}

export const getPlanDef: ToolDef = {
  name: 'get_plan',
  description: 'Get the current plan status and progress.',
  parameters: {
    type: 'object',
    properties: {},
  },
}

export function createPlanningTools() {
  let currentPlanId: string | null = null

  const createPlan = async (args: Record<string, unknown>): Promise<string> => {
    const goal = args.goal as string
    const steps = args.steps as string[]

    if (!goal || !steps?.length) return 'Error: goal and steps are required'

    const planId = `plan_${Date.now()}`
    currentPlanId = planId

    activePlans.set(planId, {
      goal,
      steps: steps.map(s => ({ description: s, status: 'pending' })),
      createdAt: Date.now(),
    })

    log.info(`Plan created: ${planId} - ${goal} (${steps.length} steps)`)

    return `✅ Plan created: "${goal}"\n\n` +
      steps.map((s, i) => `${i}. ⬜ ${s}`).join('\n') +
      `\n\nUse update_plan to track progress.`
  }

  const updatePlan = async (args: Record<string, unknown>): Promise<string> => {
    const stepIndex = args.step_index as number
    const status = args.status as 'in_progress' | 'done' | 'failed'

    if (!currentPlanId) return 'Error: no active plan. Create one with create_plan first.'

    const plan = activePlans.get(currentPlanId)
    if (!plan) return 'Error: plan not found'

    if (stepIndex < 0 || stepIndex >= plan.steps.length) {
      return `Error: invalid step index ${stepIndex}. Plan has ${plan.steps.length} steps (0-${plan.steps.length - 1}).`
    }

    plan.steps[stepIndex]!.status = status
    const icons = { pending: '⬜', in_progress: '🔄', done: '✅', failed: '❌' }

    const progress = plan.steps.filter(s => s.status === 'done').length
    const total = plan.steps.length

    return `Updated step ${stepIndex}: ${icons[status]} ${plan.steps[stepIndex]!.description}\n` +
      `Progress: ${progress}/${total} (${Math.round(progress / total * 100)}%)`
  }

  const getPlan = async (_args: Record<string, unknown>): Promise<string> => {
    if (!currentPlanId) return 'No active plan.'

    const plan = activePlans.get(currentPlanId)
    if (!plan) return 'Plan not found.'

    const icons = { pending: '⬜', in_progress: '🔄', done: '✅', failed: '❌' }
    const progress = plan.steps.filter(s => s.status === 'done').length

    return `📋 **${plan.goal}** (${progress}/${plan.steps.length})\n\n` +
      plan.steps.map((s, i) => `${i}. ${icons[s.status]} ${s.description}`).join('\n')
  }

  return { createPlan, updatePlan, getPlan }
}
