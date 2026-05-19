// packages/core/src/logger.ts
// Logger with colors, prefix, and structured tracing

import { randomUUID } from 'crypto'
import { appendFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const COLORS = {
  debug: '\x1b[36m',  // cyan
  info:  '\x1b[32m',  // green
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
}

let globalLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
let traceLogPath: string | null = null
let traceLogReady = false

export function setLogLevel(level: LogLevel) {
  globalLevel = level
}

/** Enable structured trace logging to JSON file */
export async function enableTraceLog(dataDir: string) {
  traceLogPath = resolve(dataDir, 'traces.jsonl')
  await mkdir(dataDir, { recursive: true })
  traceLogReady = true
}

export interface TraceEntry {
  traceId: string
  timestamp: string
  level: LogLevel
  prefix: string
  message: string
  data?: unknown
  durationMs?: number
}

async function writeTrace(entry: TraceEntry) {
  if (!traceLogReady || !traceLogPath) return
  try {
    await appendFile(traceLogPath, JSON.stringify(entry) + '\n')
  } catch { /* ignore write errors */ }
}

export function createLogger(prefix: string) {
  const log = (level: LogLevel, ...args: unknown[]) => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[globalLevel]) return
    const color = COLORS[level]
    const time = new Date().toLocaleTimeString()
    const tag = `${color}[${time}] [${level.toUpperCase()}] [${prefix}]${COLORS.reset}`
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](tag, ...args)

    // Write structured trace
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    writeTrace({
      traceId: traceContext.current || 'none',
      timestamp: new Date().toISOString(),
      level,
      prefix,
      message,
    })
  }

  return {
    debug: (...args: unknown[]) => log('debug', ...args),
    info:  (...args: unknown[]) => log('info', ...args),
    warn:  (...args: unknown[]) => log('warn', ...args),
    error: (...args: unknown[]) => log('error', ...args),
  }
}

/** Trace context — tracks current request trace ID */
export const traceContext = {
  current: null as string | null,

  /** Start a new trace, returns traceId */
  start(): string {
    const id = randomUUID().slice(0, 8)
    this.current = id
    return id
  },

  /** End current trace */
  end() {
    this.current = null
  },
}
