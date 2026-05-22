// packages/tools/src/plugins.ts
// Plugin system (#12) — Load tools from external folders/packages

import { createLogger } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import type { AgentLoop } from '@quasar/agent'
import { readdir, readFile } from 'fs/promises'
import { resolve, join } from 'path'
import { pathToFileURL } from 'url'

const log = createLogger('tools:plugins')

export interface PluginManifest {
  name: string
  version: string
  description?: string
  tools: Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
    handler: string // relative path to handler module
  }>
}

export interface LoadedPlugin {
  manifest: PluginManifest
  toolDefs: ToolDef[]
  handlers: Map<string, (args: Record<string, unknown>) => Promise<string>>
}

/**
 * Load plugins from a directory. Each plugin is a folder with:
 * - plugin.json (manifest)
 * - handler files referenced in manifest
 */
export async function loadPlugins(pluginsDir: string): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = []

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const pluginPath = resolve(pluginsDir, entry.name)
      const manifestPath = join(pluginPath, 'plugin.json')

      try {
        const raw = await readFile(manifestPath, 'utf-8')
        const manifest: PluginManifest = JSON.parse(raw)

        const toolDefs: ToolDef[] = []
        const handlers = new Map<string, (args: Record<string, unknown>) => Promise<string>>()

        for (const tool of manifest.tools) {
          const fullName = `plugin_${manifest.name}_${tool.name}`
          const def: ToolDef = {
            name: fullName,
            description: `[Plugin:${manifest.name}] ${tool.description}`,
            parameters: tool.parameters,
          }
          toolDefs.push(def)

          // Load handler module
          try {
            const handlerPath = resolve(pluginPath, tool.handler)
            const mod = await import(pathToFileURL(handlerPath).href)
            const handlerFn = mod.default || mod.handler || mod[tool.name]
            if (typeof handlerFn === 'function') {
              handlers.set(fullName, handlerFn)
            } else {
              log.warn(`Plugin ${manifest.name}: handler for ${tool.name} is not a function`)
              handlers.set(fullName, async () => `Error: handler not found for ${tool.name}`)
            }
          } catch (e) {
            log.error(`Plugin ${manifest.name}: failed to load handler for ${tool.name}:`, e)
            handlers.set(fullName, async () => `Error: failed to load handler for ${tool.name}`)
          }
        }

        plugins.push({ manifest, toolDefs, handlers })
        log.info(`Loaded plugin: ${manifest.name} v${manifest.version} (${toolDefs.length} tools)`)
      } catch (e) {
        log.warn(`Failed to load plugin from ${pluginPath}:`, e)
      }
    }
  } catch (e) {
    log.warn(`Plugins directory not found or empty: ${pluginsDir}`)
  }

  log.info(`${plugins.length} plugins loaded`)
  return plugins
}

/** Register all plugin tools with the agent */
export function registerPlugins(agent: AgentLoop, plugins: LoadedPlugin[]): void {
  for (const plugin of plugins) {
    for (const def of plugin.toolDefs) {
      const handler = plugin.handlers.get(def.name)
      if (handler) {
        agent.registerTool(def, handler)
      }
    }
  }
}
