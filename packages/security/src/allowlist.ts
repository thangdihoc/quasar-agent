// packages/security/src/allowlist.ts

import type { UserId } from '@quasar/core'
import { createLogger } from '@quasar/core'

const log = createLogger('security:allowlist')

export class AllowlistManager {
  private allowedUsers: Set<UserId>
  private pendingApprovals = new Map<string, {
    command: string
    resolve: (approved: boolean) => void
    timeout: NodeJS.Timeout
  }>()

  constructor(allowedUsers: number[]) {
    this.allowedUsers = new Set(allowedUsers)
    log.info(`Allowlist initialized with ${allowedUsers.length} users`)
  }

  isAllowed(userId: UserId): boolean {
    // Nếu list rỗng → cho phép tất cả
    if (this.allowedUsers.size === 0) return true
    return this.allowedUsers.has(userId)
  }

  requestApproval(id: string, command: string, timeoutMs = 60_000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(id)
        log.warn(`Approval timeout: ${command}`)
        resolve(false)
      }, timeoutMs)

      this.pendingApprovals.set(id, { command, resolve, timeout })
    })
  }

  handleApproval(id: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(id)
    if (!pending) return false

    clearTimeout(pending.timeout)
    this.pendingApprovals.delete(id)
    pending.resolve(approved)
    log.info(`Approval ${approved ? 'granted' : 'denied'}: ${pending.command}`)
    return true
  }

  hasPending(id: string): boolean {
    return this.pendingApprovals.has(id)
  }
}
