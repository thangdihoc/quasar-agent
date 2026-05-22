// packages/tools/src/memory.ts

import type { ToolDef } from '@quasar/core'
import { createLogger } from '@quasar/core'
import type { LanceDBMemory } from '@quasar/memory'

const log = createLogger('tools:memory')

export const rememberInfoDef: ToolDef = {
  name: 'remember_info',
  description: 'Store a piece of information, a fact, or a note into long-term semantic memory (RAG) for later retrieval.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The information or fact to remember (e.g. "My phone number is 0912345678")' },
      category: { type: 'string', description: 'Optional category/tags for metadata' }
    },
    required: ['text']
  }
}

export function createRememberInfoTool(vectorMemory?: LanceDBMemory) {
  return async (args: Record<string, unknown>): Promise<string> => {
    if (!vectorMemory) {
      return 'Error: Long-term vector memory (LanceDB) is not initialized or configured.'
    }
    const text = args.text as string
    const category = (args.category as string) || 'general'

    try {
      log.info(`Remembering info: "${text.slice(0, 50)}..."`)
      const id = await vectorMemory.add(text, { category, timestamp: new Date().toISOString() })
      return `Successfully saved fact to long-term memory (id: ${id}).`
    } catch (e) {
      log.error('remember_info failed:', e)
      return `Failed to save to memory: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

export const searchMemoriesDef: ToolDef = {
  name: 'search_memories',
  description: 'Search long-term semantic memory (RAG) for relevant facts or notes saved in the past.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query/concept to find in memory (e.g. "what is my phone number?")' },
      limit: { type: 'number', description: 'Number of results to return (default: 5)' }
    },
    required: ['query']
  }
}

export function createSearchMemoriesTool(vectorMemory?: LanceDBMemory) {
  return async (args: Record<string, unknown>): Promise<string> => {
    if (!vectorMemory) {
      return 'Error: Long-term vector memory (LanceDB) is not initialized or configured.'
    }
    const query = args.query as string
    const limit = (args.limit as number) || 5

    try {
      log.info(`Searching memory for: "${query}"`)
      const results = await vectorMemory.search(query, limit)
      if (results.length === 0) {
        return 'No matching memories found.'
      }

      const formatted = results
        .map((r, i) => `[${i + 1}] Fact: "${r.text}"\n    Metadata: ${JSON.stringify(r.metadata)}`)
        .join('\n\n')
      return `Found the following relevant memories:\n\n${formatted}`
    } catch (e) {
      log.error('search_memories failed:', e)
      return `Failed to search memory: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
