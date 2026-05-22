// packages/agent/src/delegation.ts
// Agent-to-Agent Delegation (#22)
// Sub-agents chuyên biệt cho từng loại task

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'

const log = createLogger('agent:delegation')

export interface SubAgentProfile {
  name: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  model?: string // Override model for this sub-agent
}

// Built-in sub-agent profiles
export const SUB_AGENTS: Record<string, SubAgentProfile> = {
  coder: {
    name: 'Coder',
    description: 'Chuyên xử lý code: viết, sửa, refactor, debug. Ưu tiên file system tools.',
    systemPrompt: `Bạn là một lập trình viên chuyên nghiệp. Hãy:
- Viết code sạch, rõ ràng, có comments
- Sử dụng best practices và design patterns
- Luôn kiểm tra lỗi và handle edge cases
- Giải thích logic khi cần`,
    allowedTools: ['file_read', 'file_write', 'file_edit', 'file_list', 'exec', 'run_code'],
  },
  researcher: {
    name: 'Researcher',
    description: 'Chuyên tìm kiếm, tổng hợp thông tin từ web và files.',
    systemPrompt: `Bạn là một nhà nghiên cứu. Hãy:
- Tìm kiếm thông tin chính xác và cập nhật
- Tổng hợp từ nhiều nguồn
- Trích dẫn nguồn khi có thể
- Phân tích và so sánh thông tin`,
    allowedTools: ['web_search', 'web_fetch', 'pdf_read', 'knowledge_search', 'knowledge_index_file'],
  },
  analyst: {
    name: 'Analyst',
    description: 'Chuyên phân tích dữ liệu, tính toán, tạo biểu đồ.',
    systemPrompt: `Bạn là một data analyst. Hãy:
- Phân tích dữ liệu kỹ lưỡng
- Sử dụng code để tính toán khi cần
- Tạo visualizations và diagrams
- Đưa ra insights từ dữ liệu`,
    allowedTools: ['run_code', 'file_read', 'render_mermaid', 'render_code_image'],
  },
  ops: {
    name: 'DevOps',
    description: 'Chuyên chạy lệnh hệ thống, quản lý process, deploy.',
    systemPrompt: `Bạn là một DevOps engineer. Hãy:
- Chạy lệnh cẩn thận, kiểm tra trước khi thực hiện
- Giải thích mỗi lệnh làm gì
- Backup trước khi thay đổi
- Monitor kết quả sau khi chạy`,
    allowedTools: ['exec', 'file_read', 'file_write', 'file_list', 'schedule_task'],
  },
}

export const delegateTaskDef: ToolDef = {
  name: 'delegate_task',
  description: `Delegate a task to a specialized sub-agent.
Available agents:
- coder: Code, file operations, debugging
- researcher: Web search, info gathering
- analyst: Data analysis, calculations, diagrams
- ops: System commands, deployment

The sub-agent will handle the task with its specialized prompt and tools.`,
  parameters: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        enum: ['coder', 'researcher', 'analyst', 'ops'],
        description: 'Sub-agent to delegate to',
      },
      task: {
        type: 'string',
        description: 'Task description for the sub-agent',
      },
    },
    required: ['agent', 'task'],
  },
}

export const listAgentsDef: ToolDef = {
  name: 'list_agents',
  description: 'List available sub-agents and their capabilities.',
  parameters: { type: 'object', properties: {} },
}

/**
 * Create delegation tools.
 * The actual delegation injects the sub-agent's system prompt context
 * and returns a prompt that guides the main loop to use specific tools.
 */
export function createDelegationTools() {
  const delegateTask = async (args: Record<string, unknown>): Promise<string> => {
    const agentName = args.agent as string
    const task = args.task as string

    const profile = SUB_AGENTS[agentName]
    if (!profile) {
      return `Error: Unknown agent "${agentName}". Available: ${Object.keys(SUB_AGENTS).join(', ')}`
    }

    log.info(`Delegating to ${profile.name}: ${task.slice(0, 100)}`)

    // Return a structured prompt that the main agent will use
    // This essentially "switches personality" for the next response
    return `🤖 [${profile.name} Agent Activated]\n\n` +
      `**System Context:**\n${profile.systemPrompt}\n\n` +
      `**Allowed Tools:** ${profile.allowedTools.join(', ')}\n\n` +
      `**Task:** ${task}\n\n` +
      `---\n` +
      `Hãy hoàn thành task trên với vai trò ${profile.name}. Chỉ sử dụng tools được cho phép.`
  }

  const listAgents = async (): Promise<string> => {
    return `🤖 Available Sub-Agents:\n\n` +
      Object.entries(SUB_AGENTS).map(([key, a]) =>
        `**${a.name}** (\`${key}\`)\n  ${a.description}\n  Tools: ${a.allowedTools.join(', ')}`
      ).join('\n\n')
  }

  return { delegateTask, listAgents }
}
