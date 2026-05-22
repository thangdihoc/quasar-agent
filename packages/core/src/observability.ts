// packages/core/src/observability.ts
// Structured observability (#15) — metrics, health checks

import { createLogger } from './logger.js'
import { eventBus } from './events.js'

const log = createLogger('core:observability')

export interface AgentMetrics {
  totalRequests: number
  totalTokens: number
  totalToolCalls: number
  toolCallsByName: Record<string, number>
  errors: number
  avgResponseTimeMs: number
  modelUsage: Record<string, number>
  uptime: number
  startedAt: number
}

class MetricsCollector {
  private metrics: AgentMetrics = {
    totalRequests: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    toolCallsByName: {},
    errors: 0,
    avgResponseTimeMs: 0,
    modelUsage: {},
    uptime: 0,
    startedAt: Date.now(),
  }

  private responseTimes: number[] = []
  private requestStartTimes = new Map<string, number>()

  constructor() {
    this.setupListeners()
    log.info('Metrics collector initialized')
  }

  private setupListeners() {
    eventBus.on('agent:start', (e) => {
      this.metrics.totalRequests++
      const ev = e as any
      this.requestStartTimes.set(ev.sessionId, Date.now())

      // Track model usage
      if (ev.model) {
        this.metrics.modelUsage[ev.model] = (this.metrics.modelUsage[ev.model] || 0) + 1
      }
    })

    eventBus.on('agent:response', (e) => {
      const ev = e as any
      const startTime = this.requestStartTimes.get(ev.sessionId)
      if (startTime) {
        const duration = Date.now() - startTime
        this.responseTimes.push(duration)
        // Keep last 100 for avg
        if (this.responseTimes.length > 100) this.responseTimes.shift()
        this.metrics.avgResponseTimeMs = Math.round(
          this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
        )
        this.requestStartTimes.delete(ev.sessionId)
      }
    })

    eventBus.on('agent:error', () => {
      this.metrics.errors++
    })

    eventBus.on('tool:call', (e) => {
      this.metrics.totalToolCalls++
      const ev = e as any
      this.metrics.toolCallsByName[ev.tool] = (this.metrics.toolCallsByName[ev.tool] || 0) + 1
    })

    eventBus.on('token:usage', (e) => {
      const ev = e as any
      this.metrics.totalTokens += ev.totalTokens || 0
    })
  }

  getMetrics(): AgentMetrics {
    return {
      ...this.metrics,
      uptime: Math.floor((Date.now() - this.metrics.startedAt) / 1000),
    }
  }

  /** Generate a human-readable report */
  getReport(): string {
    const m = this.getMetrics()
    const lines = [
      '📊 Quasar Agent Metrics',
      '═'.repeat(40),
      `Uptime: ${Math.floor(m.uptime / 3600)}h ${Math.floor((m.uptime % 3600) / 60)}m`,
      `Total requests: ${m.totalRequests}`,
      `Total tokens: ${m.totalTokens.toLocaleString()}`,
      `Total tool calls: ${m.totalToolCalls}`,
      `Errors: ${m.errors}`,
      `Avg response time: ${m.avgResponseTimeMs}ms`,
      '',
      '🛠️ Tool Usage:',
      ...Object.entries(m.toolCallsByName)
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => `  ${name}: ${count}`),
      '',
      '🤖 Model Usage:',
      ...Object.entries(m.modelUsage)
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => `  ${name}: ${count} requests`),
    ]
    return lines.join('\n')
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      toolCallsByName: {},
      errors: 0,
      avgResponseTimeMs: 0,
      modelUsage: {},
      uptime: 0,
      startedAt: Date.now(),
    }
    this.responseTimes = []
  }
}

// Singleton
export const metricsCollector = new MetricsCollector()
