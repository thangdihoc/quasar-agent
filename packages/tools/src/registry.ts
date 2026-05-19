// packages/tools/src/registry.ts
// Đăng ký tất cả tools vào AgentLoop

import type { QuasarConfig } from '@quasar/core'
import type { AgentLoop } from '@quasar/agent'
import type { SqliteMemory } from '@quasar/memory'
import { AllowlistManager } from '@quasar/security'
import { execDef, createExecTool } from './exec/powershell.js'
import { fileReadDef, fileRead } from './fs/read.js'
import { fileWriteDef, fileWrite, fileEditDef, fileEdit, fileListDef, fileList } from './fs/write.js'
import { webFetchDef, webFetch } from './web/fetch.js'
import { webSearchDef, webSearch } from './web/search.js'
import { pdfReadDef, pdfRead } from './pdf.js'

export interface RegistryOptions {
  config: QuasarConfig
  agent: AgentLoop
  memory: SqliteMemory
  allowlist: AllowlistManager
  onApprovalNeeded?: (id: string, command: string) => Promise<void>
}

export function registerAllTools(opts: RegistryOptions): void {
  const { config, agent, allowlist, onApprovalNeeded } = opts
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

  // PDF
  if (shouldRegister('pdf_read')) agent.registerTool(pdfReadDef, pdfRead)
}
