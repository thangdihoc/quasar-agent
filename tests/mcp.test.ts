import { describe, test, expect, vi } from 'vitest'
import { AgentLoop } from '../packages/agent/src/loop.js'
import { SqliteMemory } from '../packages/memory/src/sqlite.js'
import type { QuasarConfig } from '../packages/core/src/types/config.js'

const config: QuasarConfig = {
  gateway: { port: 18789, host: '127.0.0.1' },
  agent: { model: 'gpt-4o', thinkingLevel: 'medium', maxTokens: 4096 },
  telegram: { token: 'mock-token', allowedUsers: [] },
  providers: {},
  tools: { allow: [], deny: [], execRequiresApproval: false },
  memory: { sqlitePath: ':memory:', lancedbPath: '' },
}

describe('AgentLoop Dynamic MCP Management', () => {
  test('saves and removes MCP server configuration', async () => {
    const memory = new SqliteMemory(':memory:')
    const agent = new AgentLoop(config, memory)

    const testServer = {
      name: 'test-temp-mcp',
      command: 'node',
      args: ['some-script.js'],
      env: { KEY: 'VALUE' }
    }

    await agent.disconnectMcpServer(testServer.name)
    const listBefore = agent.getMcpServersList()
    expect(listBefore.some(s => s.name === testServer.name)).toBe(false)

    const saveFn = (agent as any).saveMcpServerConfig.bind(agent)
    const removeFn = (agent as any).removeMcpServerConfig.bind(agent)

    saveFn(testServer)
    const listAfter = agent.getMcpServersList()
    expect(listAfter.some(s => s.name === testServer.name)).toBe(true)

    const saved = listAfter.find(s => s.name === testServer.name)
    expect(saved?.command).toBe('node')
    expect(saved?.env?.KEY).toBe('VALUE')

    removeFn(testServer.name)
    const listFinal = agent.getMcpServersList()
    expect(listFinal.some(s => s.name === testServer.name)).toBe(false)
  })

  test('unregisters tools correctly', () => {
    const memory = new SqliteMemory(':memory:')
    const agent = new AgentLoop(config, memory)

    const dummyTool = {
      name: 'mcp_dummy_my_tool',
      description: 'Dummy',
      parameters: { type: 'object', properties: {} }
    }
    agent.registerTool(dummyTool, async () => 'hello')

    expect(agent.getToolDefs().some(t => t.name === 'mcp_dummy_my_tool')).toBe(true)

    const unregisterFn = (agent as any).unregisterMcpTools.bind(agent)
    unregisterFn('dummy')

    expect(agent.getToolDefs().some(t => t.name === 'mcp_dummy_my_tool')).toBe(false)
  })

  test('filters disabled integration tools during process', async () => {
    const memory = new SqliteMemory(':memory:')
    const agent = new AgentLoop(config, memory)

    agent.registerTool({
      name: 'mcp_github_create_issue',
      description: 'Create issue',
      parameters: { type: 'object', properties: {} }
    }, async () => 'ok')

    agent.registerTool({
      name: 'mcp_gmail_send',
      description: 'Send mail',
      parameters: { type: 'object', properties: {} }
    }, async () => 'ok')

    agent.registerTool({
      name: 'web_search',
      description: 'Search web',
      parameters: { type: 'object', properties: {} }
    }, async () => 'ok')

    const completeSpy = vi.fn().mockResolvedValue({
      content: 'Hello',
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
    })

    vi.spyOn(agent as any, 'getProvider').mockReturnValue({
      complete: completeSpy
    })

    vi.spyOn(agent, 'generateTitle').mockResolvedValue('Mock Title')

    const session1 = memory.createSession(0, 0, 'gpt-4o')
    await agent.process(session1.id, 'hello', { disabledIntegrations: ['github'] })
    const firstCallTools = completeSpy.mock.calls[0][0].tools
    expect(firstCallTools.some((t: any) => t.name === 'mcp_github_create_issue')).toBe(false)
    expect(firstCallTools.some((t: any) => t.name === 'mcp_gmail_send')).toBe(true)
    expect(firstCallTools.some((t: any) => t.name === 'web_search')).toBe(true)

    const session2 = memory.createSession(0, 0, 'gpt-4o')
    await agent.process(session2.id, 'hello', { disabledIntegrations: ['github', 'gmail'] })
    const secondCallTools = completeSpy.mock.calls[1][0].tools
    expect(secondCallTools.some((t: any) => t.name === 'mcp_github_create_issue')).toBe(false)
    expect(secondCallTools.some((t: any) => t.name === 'mcp_gmail_send')).toBe(false)
    expect(secondCallTools.some((t: any) => t.name === 'web_search')).toBe(true)
  })
})
