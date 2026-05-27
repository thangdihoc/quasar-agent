// packages/agent/src/prompt.ts
// Smart Context Injection (#18)
// Soul/Identity system (OpenClaw concept)

import type { QuasarConfig } from '@quasar/core'
import { hostname, platform, arch, totalmem } from 'os'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function getOsFriendlyName(plat: string): string {
  if (plat === 'win32') return 'Windows'
  if (plat === 'darwin') return 'macOS'
  if (plat === 'linux') return 'Linux'
  return plat
}

function loadMarkdownFile(path: string): string {
  try {
    const resolved = resolve(path)
    if (existsSync(resolved)) {
      return readFileSync(resolved, 'utf8').trim()
    }
  } catch {
    // ignore
  }
  return ''
}

function loadSoulFile(config: QuasarConfig): string {
  const soulPath = config.soul?.soulPath || './data/SOUL.md'
  return loadMarkdownFile(soulPath)
}

function loadIdentityFile(config: QuasarConfig): string {
  const identityPath = config.soul?.identityPath || './data/IDENTITY.md'
  return loadMarkdownFile(identityPath)
}

function loadUserProfile(config: QuasarConfig): string {
  const profilePath = config.soul?.userProfilePath || './data/USER_PROFILE.md'
  return loadMarkdownFile(profilePath)
}

/** Build the default hardcoded prompt (fallback when SOUL.md is missing) */
function getDefaultPersonalityPrompt(osName: string, shellName: string): string {
  return `Bạn là Quasar, một cộng sự lập trình viên ảo chuyên nghiệp, thông minh, thực tế và có cá tính riêng chạy trực tiếp trên máy tính ${osName} của người dùng.
Bạn có quyền truy cập vào các công cụ mạnh mẽ để chạy lệnh, đọc/ghi file, duyệt web, và tương tác trực tiếp với giao diện máy tính.

Tính cách & Cách ứng xử:
- Sử dụng Tiếng Việt tự nhiên, thân thiện và đời thường (xưng "mình" - "bạn", hoặc xưng "Quasar", dùng các từ cảm thán tự nhiên). Tránh trả lời như một robot vô tri.
- Luôn thấu hiểu ngữ cảnh: Nếu người dùng đang vội (hỏi ngắn, lệnh gấp), hãy trả lời cực kỳ ngắn gọn và đi thẳng vào trọng tâm. Nếu người dùng đang thảo luận thiết kế hoặc tìm hiểu lỗi phức tạp, hãy phân tích chi tiết và đưa ra lời khuyên sâu sắc.
- Chủ động phản biện: Nếu giải pháp người dùng yêu cầu có lỗi bảo mật, không tối ưu hiệu năng hoặc có phương án thay thế tốt hơn, hãy lịch sự đề xuất và phân tích trước khi thực hiện.
- Tự kiểm tra (Internal Monologue): Trước khi đưa ra quyết định quan trọng (viết code, chạy lệnh nguy hiểm), hãy tự suy nghĩ nội tâm để đảm bảo không làm hỏng dữ liệu của người dùng.
- Trả lời trung thực và thẳng thắn: Nếu bạn không biết hoặc không chắc chắn về một lỗi nào đó, hãy thừa nhận và cùng thảo luận với người dùng để tìm hướng giải quyết thay vì tự suy đoán bừa bãi.

Quy tắc kỹ thuật:
- Luôn giải thích ngắn gọn hành động nguy hiểm trước khi chạy (ví dụ: lệnh xóa, lệnh thay đổi hệ thống quan trọng).
- Ưu tiên các thao tác không phá hủy và an toàn.
- Nếu nhiệm vụ phức tạp, hãy lên kế hoạch (plan) rõ ràng từng bước trước khi bắt đầu thực hiện.
- Khi viết hoặc chỉnh sửa code, hãy giữ nguyên các chú thích, cấu trúc hiện tại của file trừ khi được yêu cầu sửa đổi.

Current capabilities:
- Execute ${shellName} commands on the user's machine
- Read, write, and edit files
- Search the web and fetch URLs
- Read PDF documents
- Generate images and audio (when configured)
- Schedule tasks with cron expressions
- Connect to MCP servers for additional tools
- Remember information long-term (RAG memory)
- Control computer screen (Computer Use)`
}

/** Build personality prompt from SOUL.md or fallback to default */
function buildPersonalityPrompt(config: QuasarConfig, osName: string, shellName: string): string {
  const soul = loadSoulFile(config)

  if (soul) {
    // SOUL.md exists — use it as personality base
    const identity = loadIdentityFile(config)
    let personalityBlock = `Bạn là một AI agent chạy trực tiếp trên máy tính ${osName} của người dùng.
Bạn có quyền truy cập vào các công cụ mạnh mẽ để chạy lệnh ${shellName}, đọc/ghi file, duyệt web, và tương tác với giao diện máy tính.

${soul}`

    if (identity) {
      personalityBlock += `\n\n${identity}`
    }

    personalityBlock += `\n\nCurrent capabilities:
- Execute ${shellName} commands on the user's machine
- Read, write, and edit files
- Search the web and fetch URLs
- Read PDF documents
- Generate images and audio (when configured)
- Schedule tasks with cron expressions
- Connect to MCP servers for additional tools
- Remember information long-term (RAG memory)
- Control computer screen (Computer Use)`

    return personalityBlock
  }

  // No SOUL.md — fallback to hardcoded default
  return getDefaultPersonalityPrompt(osName, shellName)
}

/** Build etiquette injection for group chat contexts */
function buildEtiquetteBlock(config: QuasarConfig): string {
  const etiquette = config.etiquette
  if (!etiquette?.enabled) return ''

  const respondRules = etiquette.respondWhen.map(r => {
    switch (r) {
      case 'mentioned': return '- Được nhắc tên hoặc tag trực tiếp'
      case 'question': return '- Có câu hỏi rõ ràng hướng đến bạn'
      case 'valuable_info': return '- Bạn có thông tin giá trị để đóng góp'
      case 'correction': return '- Cần sửa thông tin sai quan trọng'
      default: return `- ${r}`
    }
  }).join('\n')

  const silentRules = etiquette.silentWhen.map(r => {
    switch (r) {
      case 'casual_banter': return '- Đang tán gẫu bình thường giữa mọi người'
      case 'already_answered': return '- Có người đã trả lời rồi'
      case 'low_value': return '- Reply của bạn không thêm giá trị gì'
      default: return `- ${r}`
    }
  }).join('\n')

  return `

## Group Chat Etiquette
Bạn đang ở trong group chat. Hãy ứng xử như một participant tốt.

**Nên reply khi:**
${respondRules}

**Nên im lặng khi:**
${silentRules}

**Quy tắc:**
- Tối đa ${etiquette.maxConsecutiveReplies} tin liên tiếp — tránh spam
- Quality > Quantity — 1 reply chất lượng hơn 3 mảnh vụn
- Không phản hồi mọi message — giống con người trong group chat thật`
}

export function buildSystemPrompt(
  config: QuasarConfig,
  extraContext?: string,
  options?: { isGroupChat?: boolean }
): string {
  const plat = platform()
  const osName = getOsFriendlyName(plat)
  const shellName = plat === 'win32' ? 'PowerShell' : 'Bash'

  let prompt = config.agent.systemPrompt || buildPersonalityPrompt(config, osName, shellName)

  // Inject User Profile & Preferences
  const profile = loadUserProfile(config)
  if (profile) {
    prompt += `\n\n## User Profile & Preferences (Thông tin và sở thích của người dùng):\n${profile}`
  }

  // Inject Group Chat Etiquette
  if (options?.isGroupChat) {
    prompt += buildEtiquetteBlock(config)
  }

  // Smart Context Injection (#18) — dynamic system info
  const now = new Date()
  const contextBlock = [
    '',
    '## Current Context',
    `- Date/Time: ${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN')}`,
    `- Day: ${['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'][now.getDay()]}`,
    `- System: ${osName} ${arch()} (${hostname()})`,
    `- Memory: ${Math.round(totalmem() / 1024 / 1024 / 1024)}GB RAM`,
    `- Node.js: ${process.version}`,
  ].join('\n')

  prompt += contextBlock

  if (extraContext) {
    prompt += `\n\n${extraContext}`
  }

  return prompt
}

