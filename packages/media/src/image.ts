// packages/media/src/image.ts

import OpenAI from 'openai'
import { writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { createLogger } from '@quasar/core'

const log = createLogger('media:image')

export class ImageService {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
    log.info('Image service initialized')
  }

  async generate(
    prompt: string,
    outputPath: string,
    size: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024',
  ): Promise<string> {
    try {
      const response = await this.client.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        response_format: 'b64_json',
      })

      const data = response.data
      if (!data || !data[0]?.b64_json) throw new Error('No image data returned')
      const buffer = Buffer.from(data[0].b64_json, 'base64')
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, buffer)
      log.info(`Image generated: ${outputPath} (${buffer.length} bytes)`)
      return outputPath
    } catch (e) {
      log.error('Image gen error:', e)
      throw e
    }
  }
}
