// packages/mcp/src/client.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createLogger, QuasarError } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import type { McpServerConfig } from '@quasar/core'

const log = createLogger('mcp:client')

interface McpConnection {
  client: Client
  transport: StdioClientTransport
  tools: ToolDef[]
}

export class McpClientManager {
  private connections = new Map<string, McpConnection>()

  async connect(serverConfig: McpServerConfig): Promise<ToolDef[]> {
    log.info(`Connecting to MCP server: ${serverConfig.name}`)

    try {
      const transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env as Record<string, string> | undefined,
      })

      const client = new Client(
        { name: 'quasar-agent', version: '0.1.0' },
        { capabilities: {} }
      )

      await client.connect(transport)

      // List tools
      const result = await client.listTools()
      const tools: ToolDef[] = (result.tools || []).map((t) => ({
        name: `mcp_${serverConfig.name}_${t.name}`,
        description: `[MCP:${serverConfig.name}] ${t.description || t.name}`,
        parameters: (t.inputSchema || { type: 'object', properties: {} }) as Record<string, unknown>,
      }))

      this.connections.set(serverConfig.name, { client, transport, tools })
      log.info(`Connected to ${serverConfig.name}: ${tools.length} tools`)
      return tools
    } catch (e) {
      throw new QuasarError(`Failed to connect MCP: ${serverConfig.name}`, 'MCP_ERROR', e)
    }
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const conn = this.connections.get(serverName)
    if (!conn) throw new QuasarError(`MCP server not connected: ${serverName}`, 'MCP_ERROR')

    // Strip mcp_ prefix
    const actualToolName = toolName.replace(`mcp_${serverName}_`, '')

    const result = await conn.client.callTool({ name: actualToolName, arguments: args })
    const content = result.content as Array<{ type: string; text?: string }>
    return content.map(c => c.text || '').join('\n')
  }

  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName)
    if (conn) {
      try {
        await conn.transport.close()
        log.info(`Disconnected: ${serverName}`)
      } catch { /* ignore */ }
      this.connections.delete(serverName)
    }
  }

  getConnectedServers(): Array<{ name: string; tools: ToolDef[] }> {
    return Array.from(this.connections.entries()).map(([name, conn]) => ({
      name,
      tools: conn.tools
    }))
  }

  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.transport.close()
        log.info(`Disconnected: ${name}`)
      } catch { /* ignore */ }
    }
    this.connections.clear()
  }
}
