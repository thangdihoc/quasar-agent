// packages/agent/src/chat-etiquette.ts
// Group Chat Etiquette (OpenClaw concept)
// Decision engine: when to respond vs stay silent in group chats

import { createLogger } from '@quasar/core'
import type { EtiquetteConfig } from '@quasar/core'

const log = createLogger('agent:etiquette')

export interface ChatContext {
  /** The incoming message text */
  message: string
  /** Whether the bot was mentioned/tagged (@quasar, reply to bot, etc.) */
  isMentioned: boolean
  /** Whether this is a group chat (vs DM) */
  isGroupChat: boolean
  /** Number of consecutive bot replies without a human reply in between */
  consecutiveBotReplies: number
  /** Number of members in the group */
  memberCount?: number
  /** Whether another member already answered a question */
  hasExistingAnswer?: boolean
}

export interface EtiquetteDecision {
  respond: boolean
  reason: string
  confidence: number  // 0-1
}

/** Default etiquette config */
export function getDefaultEtiquetteConfig(): EtiquetteConfig {
  return {
    enabled: false,
    maxConsecutiveReplies: 2,
    respondWhen: ['mentioned', 'question', 'valuable_info', 'correction'],
    silentWhen: ['casual_banter', 'already_answered', 'low_value'],
  }
}

export class ChatEtiquette {
  private config: EtiquetteConfig

  constructor(config: EtiquetteConfig) {
    this.config = config
  }

  /** Decide whether the agent should respond to a group message */
  shouldRespond(context: ChatContext): EtiquetteDecision {
    // DMs always get a response
    if (!context.isGroupChat) {
      return { respond: true, reason: 'direct_message', confidence: 1 }
    }

    // Etiquette disabled → always respond
    if (!this.config.enabled) {
      return { respond: true, reason: 'etiquette_disabled', confidence: 1 }
    }

    // Anti-spam: exceeded consecutive reply limit
    if (context.consecutiveBotReplies >= this.config.maxConsecutiveReplies) {
      log.info(`Staying silent: ${context.consecutiveBotReplies} consecutive replies (max: ${this.config.maxConsecutiveReplies})`)
      return { respond: false, reason: 'max_consecutive_replies', confidence: 0.9 }
    }

    // Directly mentioned → always respond
    if (context.isMentioned && this.config.respondWhen.includes('mentioned')) {
      return { respond: true, reason: 'mentioned', confidence: 1 }
    }

    // Check message patterns
    const msg = context.message.toLowerCase().trim()

    // Question detection
    if (this.config.respondWhen.includes('question') && this.looksLikeQuestion(msg)) {
      // But skip if already answered
      if (context.hasExistingAnswer && this.config.silentWhen.includes('already_answered')) {
        return { respond: false, reason: 'already_answered', confidence: 0.7 }
      }
      return { respond: true, reason: 'question_detected', confidence: 0.8 }
    }

    // Casual banter detection
    if (this.config.silentWhen.includes('casual_banter') && this.looksLikeBanter(msg)) {
      return { respond: false, reason: 'casual_banter', confidence: 0.7 }
    }

    // Low-value response detection (very short acknowledgments)
    if (this.config.silentWhen.includes('low_value') && this.wouldBeLowValue(msg)) {
      return { respond: false, reason: 'low_value_response', confidence: 0.6 }
    }

    // Default: respond with lower confidence (can be overridden by prompt-level decision)
    return { respond: true, reason: 'default', confidence: 0.5 }
  }

  /** Heuristic: does this message look like a question? */
  private looksLikeQuestion(msg: string): boolean {
    // Vietnamese + English question patterns
    const questionPatterns = [
      /\?$/,                         // Ends with ?
      /^(ai|gì|sao|tại sao|bao giờ|ở đâu|thế nào|làm sao|có .+ không)/i,
      /^(what|how|why|when|where|who|which|can|could|is|are|do|does)/i,
      /giúp (mình|tôi|em)/i,        // Help requests
      /help/i,
    ]

    return questionPatterns.some(p => p.test(msg))
  }

  /** Heuristic: does this look like casual banter? */
  private looksLikeBanter(msg: string): boolean {
    const banterPatterns = [
      /^(haha|lol|lmao|😂|🤣|😆|hihi|hehe)+$/i,
      /^(ok|oke|okie|k|uh|um|hmm|ah|ồ|ừ|yeah|yep|nah|nope)$/i,
      /^(good morning|chào|hi|hello|bye|tạm biệt|đi ngủ|night)$/i,
      /^.{1,5}$/,  // Very short messages (1-5 chars)
    ]

    return banterPatterns.some(p => p.test(msg))
  }

  /** Heuristic: would our response likely be low-value? */
  private wouldBeLowValue(msg: string): boolean {
    // Messages that typically only need acknowledgment, not a full response
    const lowValuePatterns = [
      /^(cảm ơn|thanks|thank you|tks|ty)/i,
      /^(đã hiểu|got it|understood|roger)/i,
      /^(nice|tuyệt|cool|awesome|great|ok )/i,
    ]

    return lowValuePatterns.some(p => p.test(msg))
  }

  /** Update config at runtime */
  updateConfig(config: Partial<EtiquetteConfig>): void {
    Object.assign(this.config, config)
    log.info('Etiquette config updated')
  }
}
