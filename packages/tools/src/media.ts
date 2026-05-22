// packages/tools/src/media.ts

import type { ToolDef } from '@quasar/core'
import { createLogger } from '@quasar/core'
import type { ImageService, TTSService } from '@quasar/media'
import { resolve } from 'path'

const log = createLogger('tools:media')

export const generateImageDef: ToolDef = {
  name: 'generate_image',
  description: 'Generate an image using DALL-E 3 from a text prompt and save it to a file.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The description of the image to generate' },
      filename: { type: 'string', description: 'The filename to save the image (e.g. cat.png). Saved in data/ directory.' },
      size: { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'], description: 'The image size (default: 1024x1024)' }
    },
    required: ['prompt', 'filename']
  }
}

export function createGenerateImageTool(imageService?: ImageService) {
  return async (args: Record<string, unknown>): Promise<string> => {
    if (!imageService) {
      return 'Error: Image service is not configured (missing OpenAI API Key).'
    }
    const prompt = args.prompt as string
    const filename = args.filename as string
    const size = (args.size as '1024x1024' | '1792x1024' | '1024x1792') || '1024x1024'
    const outputPath = resolve('./data', filename)

    try {
      log.info(`Generating image for prompt: "${prompt}"`)
      await imageService.generate(prompt, outputPath, size)
      return `Successfully generated image and saved to: ${outputPath}`
    } catch (e) {
      log.error('generate_image failed:', e)
      return `Failed to generate image: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

export const textToSpeechDef: ToolDef = {
  name: 'text_to_speech',
  description: 'Synthesize text into a spoken audio file (MP3) and save it.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to convert to speech' },
      filename: { type: 'string', description: 'The filename to save the audio (e.g. speech.mp3). Saved in data/ directory.' },
      voice: { type: 'string', enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'], description: 'Voice to use (default: nova)' }
    },
    required: ['text', 'filename']
  }
}

export function createTTSTool(ttsService?: TTSService) {
  return async (args: Record<string, unknown>): Promise<string> => {
    if (!ttsService) {
      return 'Error: TTS service is not configured (missing OpenAI API Key).'
    }
    const text = args.text as string
    const filename = args.filename as string
    const voice = (args.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer') || 'nova'
    const outputPath = resolve('./data', filename)

    try {
      log.info(`Synthesizing text to speech: "${text.slice(0, 50)}..."`)
      await ttsService.synthesize(text, outputPath, voice)
      return `Successfully synthesized speech and saved to: ${outputPath}`
    } catch (e) {
      log.error('text_to_speech failed:', e)
      return `Failed to convert text to speech: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
