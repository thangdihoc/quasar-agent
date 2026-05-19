// packages/media/src/tts.ts

import OpenAI from 'openai'
import { writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { createLogger } from '@quasar/core'

const log = createLogger('media:tts')

export class TTSService {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
    log.info('TTS service initialized')
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova'
  ): Promise<string> {
    try {
      const mp3 = await this.client.audio.speech.create({
        model: 'tts-1',
        voice,
        input: text,
      })

      const buffer = Buffer.from(await mp3.arrayBuffer())
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, buffer)
      log.info(`TTS: ${outputPath} (${buffer.length} bytes)`)
      return outputPath
    } catch (e) {
      log.error('TTS error:', e)
      throw e
    }
  }
}
