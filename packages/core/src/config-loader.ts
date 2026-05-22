// packages/core/src/config-loader.ts
// Config file loader (#11) — load from quasar.config.ts or .env

import { createLogger } from './logger.js'
import type { QuasarConfig } from './types/config.js'

const log = createLogger('core:config')

/** Deep merge two objects (target is mutated) */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key]
    const targetVal = target[key]
    if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
        targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
      deepMerge(targetVal as object, sourceVal as object)
    } else if (sourceVal !== undefined) {
      (target as any)[key] = sourceVal
    }
  }
  return target
}

/** Try to load quasar.config.ts and merge with default config */
export async function loadConfigFile(defaultConfig: QuasarConfig): Promise<QuasarConfig> {
  const configPaths = ['./quasar.config.ts', './quasar.config.js', './quasar.config.mjs']

  for (const configPath of configPaths) {
    try {
      const { existsSync } = await import('fs')
      if (!existsSync(configPath)) continue

      log.info(`Loading config from ${configPath}`)
      const mod = await import(`${process.cwd()}/${configPath}`)
      const userConfig = mod.default || mod

      if (typeof userConfig === 'function') {
        const resolved = await userConfig(defaultConfig)
        return deepMerge(defaultConfig, resolved)
      } else if (typeof userConfig === 'object') {
        return deepMerge(defaultConfig, userConfig)
      }

      log.warn(`Config file ${configPath} did not export a valid config`)
    } catch (e) {
      log.warn(`Failed to load ${configPath}:`, e)
    }
  }

  return defaultConfig
}
