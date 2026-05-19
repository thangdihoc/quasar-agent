// packages/tools/src/pdf.ts

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { readFile } from 'fs/promises'

const log = createLogger('tools:pdf')

export const pdfReadDef: ToolDef = {
  name: 'pdf_read',
  description: 'Read and extract text from a PDF file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the PDF file' },
    },
    required: ['path'],
  },
}

export async function pdfRead(args: Record<string, unknown>): Promise<string> {
  const path = args.path as string
  try {
    const pdfParse = (await import('pdf-parse')).default
    const buffer = await readFile(path)
    const data = await pdfParse(buffer)
    const text = data.text.slice(0, 20_000)
    log.info(`PDF read: ${path} (${data.numpages} pages, ${text.length} chars)`)
    return `Pages: ${data.numpages}\n\n${text}`
  } catch (e) {
    return `Error reading PDF: ${e instanceof Error ? e.message : String(e)}`
  }
}
