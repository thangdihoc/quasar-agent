// packages/tools/src/registry.ts
// Đăng ký tất cả tools vào AgentLoop

import type { QuasarConfig } from '@quasar/core'
import type { AgentLoop } from '@quasar/agent'
import type { SqliteMemory, LanceDBMemory } from '@quasar/memory'
import { AllowlistManager } from '@quasar/security'
import type { ImageService, TTSService } from '@quasar/media'
import type { CronScheduler } from '@quasar/scheduler'

import { execDef, createExecTool } from './exec/powershell.js'
import { fileReadDef, fileRead } from './fs/read.js'
import { fileWriteDef, fileWrite, fileEditDef, fileEdit, fileListDef, fileList } from './fs/write.js'
import { webFetchDef, webFetch } from './web/fetch.js'
import { webSearchDef, webSearch } from './web/search.js'
import { webBrowserDef, webBrowser } from './web/browser.js'
import { pdfReadDef, pdfRead } from './pdf.js'

// Import new tools
import { generateImageDef, createGenerateImageTool, textToSpeechDef, createTTSTool } from './media.js'
import { scheduleTaskDef, createScheduleTaskTool, cancelTaskDef, createCancelTaskTool } from './scheduler.js'
import { computerUseDef, createComputerUseTool } from './computer.js'
import { rememberInfoDef, createRememberInfoTool, searchMemoriesDef, createSearchMemoriesTool } from './memory.js'
import { createPlanDef, updatePlanDef, getPlanDef, createPlanningTools } from './planning.js'
import { runCodeDef, createRunCodeTool } from './sandbox.js'
import { defineWorkflowDef, runWorkflowDef, listWorkflowsDef, createWorkflowTools } from './workflow.js'
import { renderMermaidDef, renderMermaid, renderCodeImageDef, renderCodeImage } from './render.js'
import { indexFileDef, indexFolderDef, knowledgeSearchDef, knowledgeStatsDef, createKnowledgeTools } from './knowledge.js'
import { delegateTaskDef, listAgentsDef, createDelegationTools } from '@quasar/agent'

export interface RegistryOptions {
  config: QuasarConfig
  agent: AgentLoop
  memory: SqliteMemory
  allowlist: AllowlistManager
  onApprovalNeeded?: (id: string, command: string) => Promise<void>
  imageService?: ImageService
  ttsService?: TTSService
  cronScheduler?: CronScheduler
  vectorMemory?: LanceDBMemory
  onTaskTrigger?: (id: string, prompt: string, description: string) => void | Promise<void>
}

export function registerAllTools(opts: RegistryOptions): void {
  const { config, agent, allowlist, onApprovalNeeded, imageService, ttsService, cronScheduler, vectorMemory, onTaskTrigger } = opts
  const allowed = new Set(config.tools.allow)
  const denied = new Set(config.tools.deny)

  const shouldRegister = (name: string) => {
    if (denied.has(name)) return false
    if (allowed.size === 0) return true
    return allowed.has(name)
  }

  // Exec
  if (shouldRegister('exec')) {
    agent.registerTool(execDef, createExecTool(allowlist, onApprovalNeeded))
  }

  // File tools
  if (shouldRegister('file_read')) agent.registerTool(fileReadDef, fileRead)
  if (shouldRegister('file_write')) agent.registerTool(fileWriteDef, fileWrite)
  if (shouldRegister('file_edit')) agent.registerTool(fileEditDef, fileEdit)
  if (shouldRegister('file_list')) agent.registerTool(fileListDef, fileList)

  // Web tools
  if (shouldRegister('web_fetch')) agent.registerTool(webFetchDef, webFetch)
  if (shouldRegister('web_search')) agent.registerTool(webSearchDef, webSearch)
  if (shouldRegister('web_browser')) agent.registerTool(webBrowserDef, webBrowser)

  // PDF
  if (shouldRegister('pdf_read')) agent.registerTool(pdfReadDef, pdfRead)

  // Media
  if (shouldRegister('generate_image')) {
    agent.registerTool(generateImageDef, createGenerateImageTool(imageService))
  }
  if (shouldRegister('text_to_speech')) {
    agent.registerTool(textToSpeechDef, createTTSTool(ttsService))
  }

  // Scheduler
  if (shouldRegister('schedule_task')) {
    agent.registerTool(scheduleTaskDef, createScheduleTaskTool(cronScheduler, onTaskTrigger))
  }
  if (shouldRegister('cancel_task')) {
    agent.registerTool(cancelTaskDef, createCancelTaskTool(cronScheduler))
  }

  // Computer Use
  if (shouldRegister('computer_use')) {
    const pythonPort = config.computerUse?.pythonPort || 18790
    const anthropicKey = config.providers.anthropic?.apiKey
    const googleKey = config.providers.google?.apiKey
    const openrouterKey = config.providers.openrouter?.apiKey
    agent.registerTool(
      computerUseDef,
      createComputerUseTool(pythonPort, anthropicKey, googleKey, openrouterKey)
    )
  }

  // Memory (RAG)
  if (shouldRegister('remember_info')) {
    agent.registerTool(rememberInfoDef, createRememberInfoTool(vectorMemory))
  }
  if (shouldRegister('search_memories')) {
    agent.registerTool(searchMemoriesDef, createSearchMemoriesTool(vectorMemory))
  }

  // Planning (#13)
  if (shouldRegister('create_plan')) {
    const { createPlan, updatePlan, getPlan } = createPlanningTools()
    agent.registerTool(createPlanDef, createPlan)
    agent.registerTool(updatePlanDef, updatePlan)
    agent.registerTool(getPlanDef, getPlan)
  }

  // Code Sandbox (#27)
  if (shouldRegister('run_code')) {
    agent.registerTool(runCodeDef, createRunCodeTool())
  }

  // Workflows (#28)
  if (shouldRegister('define_workflow')) {
    const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string>>()
    // Share tool handlers with workflow engine
    for (const def of agent.getToolDefs()) {
      const handler = (agent as any).toolHandlers?.get(def.name)
      if (handler) toolHandlers.set(def.name, handler)
    }
    const { defineWorkflow, runWorkflow, listWorkflows } = createWorkflowTools(toolHandlers)
    agent.registerTool(defineWorkflowDef, defineWorkflow)
    agent.registerTool(runWorkflowDef, runWorkflow)
    agent.registerTool(listWorkflowsDef, listWorkflows)
  }

  // Multi-modal render (#29)
  if (shouldRegister('render_mermaid')) {
    agent.registerTool(renderMermaidDef, renderMermaid)
  }
  if (shouldRegister('render_code_image')) {
    agent.registerTool(renderCodeImageDef, renderCodeImage)
  }

  // Knowledge Base (#26)
  if (shouldRegister('knowledge_index_file') && vectorMemory) {
    const { indexFile, indexFolder, knowledgeSearch, knowledgeStats } = createKnowledgeTools(vectorMemory)
    agent.registerTool(indexFileDef, indexFile)
    agent.registerTool(indexFolderDef, indexFolder)
    agent.registerTool(knowledgeSearchDef, knowledgeSearch)
    agent.registerTool(knowledgeStatsDef, knowledgeStats)
  }

  // Delegation (#22)
  if (shouldRegister('delegate_task')) {
    const { delegateTask, listAgents } = createDelegationTools()
    agent.registerTool(delegateTaskDef, delegateTask)
    agent.registerTool(listAgentsDef, listAgents)
  }
}

