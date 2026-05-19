// packages/tools/src/web/fetch.ts

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'

const log = createLogger('tools:web:fetch')

export const webFetchDef: ToolDef = {
  name: 'web_fetch',
  description: 'Fetch content from a URL and return as text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      maxLength: { type: 'number', description: 'Max characters to return (default: 20000)' },
    },
    required: ['url'],
  },
}

export async function webFetch(args: Record<string, unknown>): Promise<string> {
  const url = args.url as string
  const maxLength = (args.maxLength as number) || 20_000

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Quasar-Agent/0.1' },
    })
    clearTimeout(timeout)

    const contentType = response.headers.get('content-type') || ''
    let text: string

    if (contentType.includes('text') || contentType.includes('json') || contentType.includes('xml')) {
      text = await response.text()
    } else {
      return `Binary content (${contentType}), size: ${response.headers.get('content-length') || 'unknown'} bytes`
    }

    // Strip HTML tags for cleaner output
    if (contentType.includes('html')) {
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const truncated = text.length > maxLength ? text.slice(0, maxLength) + '\n... (truncated)' : text
    log.info(`Fetched: ${url} (${truncated.length} chars)`)
    return truncated
  } catch (e) {
    return `Error fetching URL: ${e instanceof Error ? e.message : String(e)}`
  }
}
