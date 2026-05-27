// packages/agent/src/heartbeat.ts
// Heartbeat System (OpenClaw concept)
// Agent chủ động poll tasks theo interval, đọc HEARTBEAT.md checklist

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { createLogger, eventBus } from '@quasar/core'
import type { HeartbeatConfig, QuasarConfig } from '@quasar/core'
import type { CronScheduler } from '@quasar/scheduler'

const log = createLogger('agent:heartbeat')

const HEARTBEAT_CRON_ID = '__quasar_heartbeat__'

export interface HeartbeatState {
  lastTick: number
  lastChecks: Record<string, number>
  tickCount: number
}

export interface HeartbeatResult {
  skipped: boolean
  reason?: string
  checks: string[]
  response?: string
}

/** Default heartbeat config */
export function getDefaultHeartbeatConfig(): HeartbeatConfig {
  return {
    enabled: false,
    intervalMinutes: 30,
    quietHoursStart: 23,
    quietHoursEnd: 8,
    checklistPath: './data/HEARTBEAT.md',
    statePath: './data/heartbeat-state.json',
  }
}

export class HeartbeatEngine {
  private config: HeartbeatConfig
  private scheduler: CronScheduler
  private processCallback: (prompt: string) => Promise<string>
  private state: HeartbeatState
  private running = false

  constructor(
    config: HeartbeatConfig,
    scheduler: CronScheduler,
    processCallback: (prompt: string) => Promise<string>,
  ) {
    this.config = config
    this.scheduler = scheduler
    this.processCallback = processCallback
    this.state = this.loadState()
  }

  /** Check if current time is in quiet hours */
  isQuietHours(): boolean {
    const hour = new Date().getHours()
    const { quietHoursStart, quietHoursEnd } = this.config

    // Handle midnight wrap: e.g. 23-8 means 23,0,1,2,3,4,5,6,7
    if (quietHoursStart > quietHoursEnd) {
      return hour >= quietHoursStart || hour < quietHoursEnd
    }
    return hour >= quietHoursStart && hour < quietHoursEnd
  }

  /** Parse HEARTBEAT.md and extract active checklist items */
  parseChecklist(): string[] {
    const checklistPath = resolve(this.config.checklistPath)
    if (!existsSync(checklistPath)) return []

    try {
      const content = readFileSync(checklistPath, 'utf8')
      const lines = content.split('\n')
      const checks: string[] = []

      for (const line of lines) {
        const trimmed = line.trim()
        // Match unchecked items: - [ ] description
        if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- []')) {
          const item = trimmed.replace(/^- \[[ ]?\]\s*/, '').trim()
          if (item) checks.push(item)
        }
      }

      return checks
    } catch (e) {
      log.error('Failed to parse HEARTBEAT.md:', e)
      return []
    }
  }

  /** Load heartbeat state from disk */
  private loadState(): HeartbeatState {
    const statePath = resolve(this.config.statePath)
    try {
      if (existsSync(statePath)) {
        const raw = readFileSync(statePath, 'utf8')
        return JSON.parse(raw) as HeartbeatState
      }
    } catch (e) {
      log.warn('Failed to load heartbeat state, using defaults:', e)
    }
    return { lastTick: 0, lastChecks: {}, tickCount: 0 }
  }

  /** Save heartbeat state to disk */
  private saveState(): void {
    const statePath = resolve(this.config.statePath)
    try {
      const dir = dirname(statePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(statePath, JSON.stringify(this.state, null, 2), 'utf8')
    } catch (e) {
      log.error('Failed to save heartbeat state:', e)
    }
  }

  /** Run a single heartbeat tick */
  async runOnce(): Promise<HeartbeatResult> {
    const now = Date.now()

    // Check quiet hours
    if (this.isQuietHours()) {
      eventBus.emit('heartbeat:skip', {
        type: 'heartbeat:skip',
        reason: 'quiet_hours',
      })
      log.info('Heartbeat skipped: quiet hours')
      return { skipped: true, reason: 'quiet_hours', checks: [] }
    }

    // Parse checklist
    const checks = this.parseChecklist()
    if (checks.length === 0) {
      eventBus.emit('heartbeat:skip', {
        type: 'heartbeat:skip',
        reason: 'no_checklist',
      })
      log.info('Heartbeat skipped: no active checklist items')
      return { skipped: true, reason: 'no_checklist', checks: [] }
    }

    // Emit tick event
    eventBus.emit('heartbeat:tick', {
      type: 'heartbeat:tick',
      timestamp: now,
    })

    // Build heartbeat prompt
    const prompt = this.buildHeartbeatPrompt(checks)

    try {
      log.info(`Heartbeat tick #${this.state.tickCount + 1}: ${checks.length} checks`)
      const response = await this.processCallback(prompt)

      // Update state
      this.state.lastTick = now
      this.state.tickCount++
      for (const check of checks) {
        this.state.lastChecks[check] = now
      }
      this.saveState()

      // Emit result
      eventBus.emit('heartbeat:result', {
        type: 'heartbeat:result',
        message: response.slice(0, 500),
        checks,
      })

      return { skipped: false, checks, response }
    } catch (e) {
      log.error('Heartbeat processing failed:', e)
      return { skipped: true, reason: 'error', checks }
    }
  }

  /** Build the prompt for agent to process during heartbeat */
  private buildHeartbeatPrompt(checks: string[]): string {
    const checkList = checks.map((c, i) => `${i + 1}. ${c}`).join('\n')

    return `[HEARTBEAT] Đây là heartbeat tự động. Hãy thực hiện các kiểm tra sau:

${checkList}

Nếu có thông tin quan trọng hoặc cần thông báo cho user → trả lời rõ ràng.
Nếu không có gì đáng chú ý → trả lời "HEARTBEAT_OK" để skip.
Giữ ngắn gọn.`
  }

  /** Start the heartbeat cron job */
  start(): void {
    if (!this.config.enabled) {
      eventBus.emit('heartbeat:skip', {
        type: 'heartbeat:skip',
        reason: 'disabled',
      })
      log.info('Heartbeat disabled in config')
      return
    }

    if (this.running) {
      log.warn('Heartbeat already running')
      return
    }

    // Convert intervalMinutes to cron expression
    const minutes = this.config.intervalMinutes
    const cronExpr = `*/${minutes} * * * *`

    const success = this.scheduler.schedule(
      HEARTBEAT_CRON_ID,
      cronExpr,
      `Quasar heartbeat (every ${minutes}min)`,
      async () => { await this.runOnce() }
    )

    if (success) {
      this.running = true
      log.info(`Heartbeat started: every ${minutes} minutes`)
    } else {
      log.error('Failed to start heartbeat cron job')
    }
  }

  /** Stop the heartbeat */
  stop(): void {
    this.scheduler.cancel(HEARTBEAT_CRON_ID)
    this.running = false
    log.info('Heartbeat stopped')
  }

  /** Get current heartbeat state */
  getState(): HeartbeatState {
    return { ...this.state }
  }

  isRunning(): boolean {
    return this.running
  }
}
