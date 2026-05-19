// packages/tools/src/web/search.ts
// DuckDuckGo search — free, no API key

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'

const log = createLogger('tools:web:search')

export const webSearchDef: ToolDef = {
  name: 'web_search',
  description: 'Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      maxResults: { type: 'number', description: 'Max results (default: 8)' },
    },
    required: ['query'],
  },
}

export async function webSearch(args: Record<string, unknown>): Promise<string> {
  const query = args.query as string
  const maxResults = (args.maxResults as number) || 8

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    const html = await response.text()

    // Parse results from HTML
    const results: Array<{ title: string; url: string; snippet: string }> = []
    const resultRegex = /<a rel="nofollow" class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

    let match
    while ((match = resultRegex.exec(html)) && results.length < maxResults) {
      const rawUrl = match[1] || ''
      const title = (match[2] || '').replace(/<[^>]+>/g, '').trim()
      const snippet = (match[3] || '').replace(/<[^>]+>/g, '').trim()

      // Decode DuckDuckGo redirect URL
      let cleanUrl = rawUrl
      try {
        const decoded = decodeURIComponent(rawUrl)
        const uddg = decoded.match(/uddg=([^&]+)/)
        if (uddg) cleanUrl = decodeURIComponent(uddg[1]!)
      } catch { /* keep original */ }

      if (title) results.push({ title, url: cleanUrl, snippet })
    }

    if (results.length === 0) {
      return `No results found for: ${query}`
    }

    const output = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
    ).join('\n\n')

    log.info(`Search: "${query}" → ${results.length} results`)
    return output
  } catch (e) {
    return `Error searching: ${e instanceof Error ? e.message : String(e)}`
  }
}
