// packages/telegram/src/formatter.ts

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

export function truncate(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '\n... (truncated)'
}

export function formatResponse(text: string): string {
  // Telegram has 4096 char limit
  return truncate(text, 4000)
}
