// packages/tools/src/render.ts
// Multi-modal output tools (#29) — render code/diagrams to images

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { randomUUID } from 'crypto'

const log = createLogger('tools:render')

export const renderMermaidDef: ToolDef = {
  name: 'render_mermaid',
  description: `Render a Mermaid diagram to SVG/PNG image using the Mermaid.ink API.
Supports: flowchart, sequence, class, state, ER, gantt, pie, mindmap.
Returns the URL of the rendered image.`,
  parameters: {
    type: 'object',
    properties: {
      diagram: {
        type: 'string',
        description: 'Mermaid diagram code (e.g., "graph TD; A-->B; B-->C")',
      },
      format: {
        type: 'string',
        enum: ['svg', 'png'],
        description: 'Output format (default: svg)',
      },
      theme: {
        type: 'string',
        enum: ['default', 'dark', 'forest', 'neutral'],
        description: 'Diagram theme (default: default)',
      },
    },
    required: ['diagram'],
  },
}

export const renderCodeImageDef: ToolDef = {
  name: 'render_code_image',
  description: `Render a code snippet to a beautiful image (like carbon.sh).
Uses the ray.so API. Returns the image URL.`,
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Code snippet to render' },
      language: { type: 'string', description: 'Programming language (e.g., python, javascript)' },
      theme: {
        type: 'string',
        enum: ['breeze', 'candy', 'crimson', 'falcon', 'meadow', 'midnight', 'raindrop', 'sunset'],
        description: 'Color theme (default: midnight)',
      },
      title: { type: 'string', description: 'Optional title for the code image' },
    },
    required: ['code', 'language'],
  },
}

export async function renderMermaid(args: Record<string, unknown>): Promise<string> {
  const diagram = args.diagram as string
  const format = (args.format as string) || 'svg'
  const theme = (args.theme as string) || 'default'

  if (!diagram) return 'Error: diagram code is required'

  try {
    // Use mermaid.ink to render
    const encoded = Buffer.from(diagram).toString('base64url')
    const url = `https://mermaid.ink/${format}/${encoded}?theme=${theme}`

    // Verify it works by fetching
    const response = await fetch(url, { method: 'HEAD' })
    if (!response.ok) {
      return `Error: Failed to render diagram (HTTP ${response.status}). Check your Mermaid syntax.`
    }

    log.info(`Mermaid diagram rendered: ${url.slice(0, 80)}...`)
    return `✅ Diagram rendered!\n\n🔗 URL: ${url}\n\nYou can share this URL or embed it with:\n\`![diagram](${url})\``
  } catch (e) {
    return `Error rendering diagram: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function renderCodeImage(args: Record<string, unknown>): Promise<string> {
  const code = args.code as string
  const language = args.language as string
  const theme = (args.theme as string) || 'midnight'
  const title = (args.title as string) || ''

  if (!code) return 'Error: code is required'

  try {
    // Use ray.so URL builder
    const encoded = Buffer.from(code).toString('base64url')
    const url = `https://ray.so/#theme=${theme}&background=true&darkMode=true&padding=32&language=${language}&title=${encodeURIComponent(title)}&code=${encoded}`

    log.info(`Code image URL generated for ${language}`)
    return `✅ Code image ready!\n\n🔗 Open in browser: ${url}\n\nNote: ray.so renders interactively. For static images, use a screenshot tool or the generate_image tool.`
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`
  }
}
