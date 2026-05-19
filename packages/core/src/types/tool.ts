// packages/core/src/types/tool.ts

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  callId: string
  name: string
  result: string
  isError?: boolean
}
