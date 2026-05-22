// packages/tools/src/knowledge.ts
// Knowledge Base (#26) — auto-index files, search knowledge, manage

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import type { LanceDBMemory } from '@quasar/memory'
import { readFile, readdir, stat } from 'fs/promises'
import { resolve, extname, basename } from 'path'

const log = createLogger('tools:knowledge')

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.ts', '.js', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.sql', '.sh', '.bat',
  '.env', '.cfg', '.ini', '.csv', '.log',
])

export const indexFileDef: ToolDef = {
  name: 'knowledge_index_file',
  description: `Index a file into the knowledge base for long-term retrieval.
Splits the file into chunks and stores in vector database.
Supports text files (code, markdown, config, etc.).`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to index' },
    },
    required: ['path'],
  },
}

export const indexFolderDef: ToolDef = {
  name: 'knowledge_index_folder',
  description: `Index an entire folder into the knowledge base.
Recursively reads all text files and indexes them.
Max depth: 3 levels, max files: 100.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder path to index' },
      maxFiles: { type: 'number', description: 'Max files to index (default: 50)' },
    },
    required: ['path'],
  },
}

export const knowledgeSearchDef: ToolDef = {
  name: 'knowledge_search',
  description: `Search the knowledge base for relevant information.
Returns the most similar stored texts using vector similarity.`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK: { type: 'number', description: 'Number of results (default: 5)' },
    },
    required: ['query'],
  },
}

export const knowledgeStatsDef: ToolDef = {
  name: 'knowledge_stats',
  description: 'Get knowledge base statistics.',
  parameters: { type: 'object', properties: {} },
}

/** Split text into overlapping chunks for better retrieval */
function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length)
    chunks.push(words.slice(start, end).join(' '))
    start += chunkSize - overlap
  }

  return chunks
}

let indexedFileCount = 0
let indexedChunkCount = 0

export function createKnowledgeTools(vectorMemory: LanceDBMemory) {
  const indexFile = async (args: Record<string, unknown>): Promise<string> => {
    const filePath = args.path as string
    if (!filePath) return 'Error: path is required'

    try {
      const ext = extname(filePath).toLowerCase()
      if (!TEXT_EXTENSIONS.has(ext)) {
        return `Error: unsupported file type "${ext}". Only text files are supported.`
      }

      const content = await readFile(resolve(filePath), 'utf-8')
      const fileName = basename(filePath)
      const chunks = chunkText(content)

      for (const chunk of chunks) {
        await vectorMemory.add(`[${fileName}] ${chunk}`)
      }

      indexedFileCount++
      indexedChunkCount += chunks.length

      log.info(`Indexed: ${fileName} (${chunks.length} chunks)`)
      return `✅ Indexed "${fileName}": ${chunks.length} chunks stored in knowledge base.`
    } catch (e) {
      return `Error indexing file: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const indexFolder = async (args: Record<string, unknown>): Promise<string> => {
    const folderPath = args.path as string
    const maxFiles = (args.maxFiles as number) || 50
    if (!folderPath) return 'Error: path is required'

    try {
      const files: string[] = []

      async function walk(dir: string, depth = 0) {
        if (depth > 3 || files.length >= maxFiles) return
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (files.length >= maxFiles) break
          const fullPath = resolve(dir, entry.name)
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await walk(fullPath, depth + 1)
          } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            // Skip files > 1MB
            const s = await stat(fullPath)
            if (s.size < 1_000_000) files.push(fullPath)
          }
        }
      }

      await walk(resolve(folderPath))

      let totalChunks = 0
      for (const file of files) {
        try {
          const content = await readFile(file, 'utf-8')
          const chunks = chunkText(content)
          for (const chunk of chunks) {
            await vectorMemory.add(`[${basename(file)}] ${chunk}`)
          }
          totalChunks += chunks.length
          indexedFileCount++
          indexedChunkCount += chunks.length
        } catch { /* skip unreadable */ }
      }

      log.info(`Folder indexed: ${folderPath} (${files.length} files, ${totalChunks} chunks)`)
      return `✅ Indexed ${files.length} files from "${folderPath}":\n${totalChunks} chunks stored in knowledge base.`
    } catch (e) {
      return `Error indexing folder: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const knowledgeSearch = async (args: Record<string, unknown>): Promise<string> => {
    const query = args.query as string
    const topK = (args.topK as number) || 5
    if (!query) return 'Error: query is required'

    try {
      const results = await vectorMemory.search(query, topK)
      if (results.length === 0) return 'No relevant knowledge found.'

      return `📚 Knowledge search results (${results.length}):\n\n` +
        results.map((r, i) => `${i + 1}. (score: ${r.score?.toFixed(3) || 'N/A'})\n   ${r.text.slice(0, 300)}`).join('\n\n')
    } catch (e) {
      return `Error searching knowledge: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const knowledgeStats = async (): Promise<string> => {
    return `📊 Knowledge Base Stats:\n` +
      `Files indexed: ${indexedFileCount}\n` +
      `Total chunks: ${indexedChunkCount}\n` +
      `Supported extensions: ${Array.from(TEXT_EXTENSIONS).join(', ')}`
  }

  return { indexFile, indexFolder, knowledgeSearch, knowledgeStats }
}
