// packages/core/src/errors.ts

export class QuasarError extends Error {
  public readonly code: string
  public override readonly cause?: unknown

  constructor(message: string, code: string, cause?: unknown) {
    super(message)
    this.name = 'QuasarError'
    this.code = code
    this.cause = cause
  }
}

export class ProviderError extends QuasarError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PROVIDER_ERROR', cause)
    this.name = 'ProviderError'
  }
}

export class ToolError extends QuasarError {
  constructor(message: string, cause?: unknown) {
    super(message, 'TOOL_ERROR', cause)
    this.name = 'ToolError'
  }
}

export class MemoryError extends QuasarError {
  constructor(message: string, cause?: unknown) {
    super(message, 'MEMORY_ERROR', cause)
    this.name = 'MemoryError'
  }
}

export class TelegramError extends QuasarError {
  constructor(message: string, cause?: unknown) {
    super(message, 'TELEGRAM_ERROR', cause)
    this.name = 'TelegramError'
  }
}

export class ConfigError extends QuasarError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause)
    this.name = 'ConfigError'
  }
}
