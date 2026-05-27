// packages/tools/src/web/browser.ts

import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger, eventBus } from '@quasar/core'
import type { ToolDef } from '@quasar/core'
import { AllowlistManager } from '@quasar/security'
import { randomUUID } from 'crypto'

const log = createLogger('tools:web:browser')

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../../../web/src/public')
const screenshotDir = join(publicDir, 'screenshots')

let browserInstance: Browser | null = null
let contextInstance: BrowserContext | null = null
let pageInstance: Page | null = null

export interface BrowserState {
  url: string
  title: string
  screenshot: string
  elements: Array<{ refId: string; tag: string; text: string; type?: string; placeholder?: string }>
}

export let latestBrowserState: BrowserState | null = null

export function getLatestBrowserState(): BrowserState | null {
  return latestBrowserState
}

function resolveSelector(selector: string): string {
  if (!selector) return selector
  const clean = selector.trim()
  // Match plain number like "12"
  if (/^\d+$/.test(clean)) {
    return `[data-quasar-ref="${clean}"]`
  }
  // Match "[Ref: 12]" or "[12]"
  const match = clean.match(/^\[(?:Ref:\s*)?(\d+)\]$/i)
  if (match) {
    return `[data-quasar-ref="${match[1]}"]`
  }
  return selector
}

async function markInteractiveElements(page: Page): Promise<void> {
  try {
    await page.evaluate(`() => {
      const existing = document.querySelectorAll('[data-quasar-ref]');
      existing.forEach(el => el.removeAttribute('data-quasar-ref'));

      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const interactiveSelectors = [
        'a',
        'button',
        'input:not([type="hidden"])',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="menuitem"]',
        '[onclick]',
        '.clickable'
      ].join(',');

      const all = Array.from(document.querySelectorAll(interactiveSelectors));
      let refId = 1;
      for (const el of all) {
        if (isVisible(el)) {
          el.setAttribute('data-quasar-ref', String(refId++));
        }
      }
    }`);
  } catch (e) {
    log.error('Failed to mark interactive elements:', e)
  }
}

async function updateBrowserState(page: Page): Promise<void> {
  try {
    await markInteractiveElements(page)

    const elements = await page.evaluate(`() => {
      const els = Array.from(document.querySelectorAll('[data-quasar-ref]'));
      return els.map(el => {
        const refId = el.getAttribute('data-quasar-ref') || '';
        const tag = el.tagName.toLowerCase();
        let text = el.innerText?.trim() || '';
        if (!text && tag === 'input') {
          text = el.value || '';
        }
        const type = el.getAttribute('type') || undefined;
        const placeholder = el.getAttribute('placeholder') || undefined;
        return { refId, tag, text: text.slice(0, 50), type, placeholder };
      });
    }`) as any;

    const screenshot = await takeScreenshot(page)

    latestBrowserState = {
      url: page.url(),
      title: await page.title(),
      screenshot,
      elements
    }

    eventBus.emit('browser:update', {
      type: 'browser:update',
      url: latestBrowserState.url,
      title: latestBrowserState.title,
      screenshot: latestBrowserState.screenshot,
      elements: latestBrowserState.elements
    })
  } catch (e) {
    log.error('Failed to update browser state:', e)
  }
}

export const webBrowserDef: ToolDef = {
  name: 'web_browser',
  description: 'Control a separate browser instance (Playwright) to navigate websites, click, type, and extract contents. The browser maintains session cookies across calls in the same run.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'click', 'type', 'scroll', 'hover', 'back', 'screenshot', 'get_html', 'get_text', 'close'],
        description: 'The browser action to perform'
      },
      url: {
        type: 'string',
        description: 'The URL to navigate to (required for action: navigate)'
      },
      selector: {
        type: 'string',
        description: 'CSS selector, text, or reference ID number (e.g. "12", "[Ref: 12]", "[12]") to click, type, or hover (required for click, type, hover)'
      },
      text: {
        type: 'string',
        description: 'The text to type (required for action: type)'
      },
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: 'Scroll direction (required for action: scroll)'
      },
      headless: {
        type: 'boolean',
        description: 'Whether to run browser in headless mode (default: false, meaning headed browser window pops up so the user can watch).'
      }
    },
    required: ['action']
  }
}

async function getOrCreateBrowser(headless = false, usePersonalProfile = false): Promise<Page> {
  if (contextInstance && pageInstance) {
    if (pageInstance.isClosed()) {
      log.info('Page is closed, re-initializing...')
      await cleanup()
    } else {
      return pageInstance
    }
  }

  if (usePersonalProfile) {
    const profilePath = resolve('./data/chrome-profile')
    log.info(`Launching Playwright Chromium with persistent personal profile at ${profilePath}...`)
    contextInstance = await chromium.launchPersistentContext(profilePath, {
      headless: false, // Personal profile should be headed so user can interact/login
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const pages = contextInstance.pages()
    pageInstance = pages.length > 0 ? pages[0]! : await contextInstance.newPage()
    return pageInstance
  }

  log.info(`Launching Playwright Chromium (headless: ${headless})...`)
  browserInstance = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  
  contextInstance = await browserInstance.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  })
  
  pageInstance = await contextInstance.newPage()
  pageInstance.setDefaultTimeout(15000)
  pageInstance.setDefaultNavigationTimeout(20000)
  
  return pageInstance
}

async function cleanup() {
  try {
    if (pageInstance && !pageInstance.isClosed()) await pageInstance.close()
  } catch {}
  try {
    if (contextInstance) await contextInstance.close()
  } catch {}
  try {
    if (browserInstance) await browserInstance.close()
  } catch {}
  pageInstance = null
  contextInstance = null
  browserInstance = null
}

async function takeScreenshot(page: Page): Promise<string> {
  try {
    const filename = `browser_${Date.now()}.png`
    if (!existsSync(screenshotDir)) {
      mkdirSync(screenshotDir, { recursive: true })
    }
    const filepath = join(screenshotDir, filename)
    await page.screenshot({ path: filepath })
    // Return relative URL that Express server will serve
    return `http://127.0.0.1:18789/screenshots/${filename}`
  } catch (e) {
    log.error('Failed to take screenshot:', e)
    return 'Failed to capture screenshot'
  }
}

/**
 * TokenJuice HTML Compressor: Converts raw HTML to clean and optimized Markdown.
 * Strips script tags, style sheets, SVGs, navigations, footers, headers,
 * formats links, headers and lists, and collapses redundant spaces.
 */
function cleanHtmlToMarkdown(html: string, baseUrl: string): string {
  if (!html) return ''

  let text = html
    // 1. Remove script, style, svg, noscript, header, footer, nav tags and their contents
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    // 2. Format headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    // 3. Format lists
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    // Format buttons: <button data-quasar-ref="X">text</button> -> [Ref: X] [Button: text]
    .replace(/<button([^>]*)>([\s\S]*?)<\/button>/gi, (match, attrs, btnText) => {
      const cleanText = btnText.replace(/<[^>]+>/g, '').trim()
      const refMatch = attrs.match(/data-quasar-ref="(\d+)"/i)
      const refPrefix = refMatch ? `[Ref: ${refMatch[1]}] ` : ''
      return ` \n${refPrefix}[Button: ${cleanText || 'button'}]\n `
    })
    // Format inputs: <input data-quasar-ref="X" ...> -> [Ref: X] [Input: description]
    .replace(/<input([^+>]+)>/gi, (match, attrs) => {
      const refMatch = attrs.match(/data-quasar-ref="(\d+)"/i)
      if (!refMatch) return ''
      const refPrefix = `[Ref: ${refMatch[1]}] `
      
      const typeMatch = attrs.match(/type="([^"]+)"/i)
      const type = typeMatch ? typeMatch[1] : 'text'
      
      const placeholderMatch = attrs.match(/placeholder="([^"]+)"/i)
      const placeholder = placeholderMatch ? placeholderMatch[1] : ''
      
      const valueMatch = attrs.match(/value="([^"]+)"/i)
      const value = valueMatch ? valueMatch[1] : ''

      let desc = ''
      if (placeholder) desc = `placeholder: "${placeholder}"`
      else if (value) desc = `value: "${value}"`
      else desc = `type: "${type}"`

      return ` \n${refPrefix}[Input: ${desc}]\n `
    })
    // Format textareas: <textarea data-quasar-ref="X" ...> -> [Ref: X] [Textarea: placeholder]
    .replace(/<textarea([^>]*?)>([\s\S]*?)<\/textarea>/gi, (match, attrs, content) => {
      const refMatch = attrs.match(/data-quasar-ref="(\d+)"/i)
      if (!refMatch) return ''
      const refPrefix = `[Ref: ${refMatch[1]}] `
      
      const placeholderMatch = attrs.match(/placeholder="([^"]+)"/i)
      const placeholder = placeholderMatch ? placeholderMatch[1] : ''
      
      return ` \n${refPrefix}[Textarea${placeholder ? ` placeholder: "${placeholder}"` : ''}]\n `
    })
    // Format selects: <select data-quasar-ref="X" ...> -> [Ref: X] [Select]
    .replace(/<select([^>]*?)>([\s\S]*?)<\/select>/gi, (match, attrs, content) => {
      const refMatch = attrs.match(/data-quasar-ref="(\d+)"/i)
      if (!refMatch) return ''
      const refPrefix = `[Ref: ${refMatch[1]}] `
      return ` \n${refPrefix}[Select]\n `
    })
    // 4. Format links: <a href="...">text</a> -> [Ref: X] [text](href)
    .replace(/<a([^>]+)href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (match, attrs, href, linkText) => {
      const cleanText = linkText.replace(/<[^>]+>/g, '').trim()
      if (!cleanText) return ''
      
      const refMatch = attrs.match(/data-quasar-ref="(\d+)"/i) || match.match(/data-quasar-ref="(\d+)"/i)
      const refPrefix = refMatch ? `[Ref: ${refMatch[1]}] ` : ''

      let absoluteUrl = href
      try {
        if (href.startsWith('/') || !href.includes('://')) {
          absoluteUrl = new URL(href, baseUrl).toString()
        }
      } catch {}
      
      return ` ${refPrefix}[${cleanText}](${absoluteUrl}) `
    })
    // 5. Replace structural elements with line breaks
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // 6. Strip all remaining HTML tags
    .replace(/<[^>]+>/g, ' ')

  // Decode common HTML entities
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&middot;': '·',
    '&ndash;': '–',
    '&mdash;': '—'
  }
  
  for (const [entity, replacement] of Object.entries(entities)) {
    text = text.replaceAll(entity, replacement)
  }

  // 7. Clean up whitespace and collapse contiguous empty lines
  const lines = text.split('\n')
  const cleanedLines: string[] = []
  let lastWasEmpty = false

  for (let line of lines) {
    line = line.trim().replace(/\s+/g, ' ')
    if (!line) {
      if (!lastWasEmpty) {
        cleanedLines.push('')
        lastWasEmpty = true
      }
    } else {
      cleanedLines.push(line)
      lastWasEmpty = false
    }
  }

  return cleanedLines.join('\n').trim()
}

export function createWebBrowserTool(
  allowlist?: AllowlistManager,
  onApprovalNeeded?: (id: string, message: string) => Promise<void>
) {
  return async (args: Record<string, unknown>): Promise<string> => {
    const action = args.action as string
    const headless = args.headless !== false // Default is headless: true for background, but allow headless: false in definition

    try {
      if (action === 'close') {
        await cleanup()
        latestBrowserState = null
        eventBus.emit('browser:update', {
          type: 'browser:update',
          url: '',
          title: '',
          screenshot: '',
          elements: []
        })
        return 'Browser closed successfully.'
      }

      // Launch or retrieve page
      let usePersonalProfile = false
      if (!contextInstance || !pageInstance || pageInstance.isClosed()) {
        if (allowlist && onApprovalNeeded) {
          const approvalId = randomUUID()
          const promptMsg = "Sử dụng tài khoản Chrome cá nhân (Keep logins, cookies)?"
          await onApprovalNeeded(approvalId, promptMsg)
          log.info(`Requesting Chrome profile approval (ID: ${approvalId})...`)
          const approved = await allowlist.requestApproval(approvalId, promptMsg, 20_000)
          if (approved) {
            usePersonalProfile = true
            log.info('User approved using personal Chrome profile.')
          } else {
            log.info('User denied or timed out. Falling back to incognito.')
          }
        }
      }

      const page = await getOrCreateBrowser(headless, usePersonalProfile)

      if (action === 'navigate') {
        const url = args.url as string
        if (!url) return 'Error: url is required for navigate action.'
        
        log.info(`Navigating to: ${url}`)
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1000) // Wait brief moment for dynamic contents

        await updateBrowserState(page)

        const html = await page.content()
        const title = await page.title()
        const currentUrl = page.url()
        const markdown = cleanHtmlToMarkdown(html, currentUrl)
        const screenshot = latestBrowserState?.screenshot || ''

        return `Successfully loaded page.
URL: ${currentUrl}
Title: ${title}
Screenshot: ${screenshot}

--- Content (TokenJuice Compressed) ---
${markdown}`
      }

      if (action === 'click') {
        let selector = args.selector as string
        if (!selector) return 'Error: selector is required for click action.'

        selector = resolveSelector(selector)
        log.info(`Clicking element: ${selector}`)
        
        // Try resolving by text if CSS selector fails
        if (!selector.startsWith('/') && !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes('=') && !selector.startsWith('[')) {
          // Try finding by text
          try {
            await page.click(`text="${selector}"`, { timeout: 4000 })
          } catch {
            await page.click(selector)
          }
        } else {
          await page.click(selector)
        }

        await page.waitForTimeout(1500) // Wait for render/navigation
        await updateBrowserState(page)

        const html = await page.content()
        const title = await page.title()
        const currentUrl = page.url()
        const markdown = cleanHtmlToMarkdown(html, currentUrl)
        const screenshot = latestBrowserState?.screenshot || ''

        return `Successfully clicked.
URL: ${currentUrl}
Title: ${title}
Screenshot: ${screenshot}

--- Content (TokenJuice Compressed) ---
${markdown}`
      }

      if (action === 'type') {
        let selector = args.selector as string
        const text = args.text as string
        if (!selector) return 'Error: selector is required for type action.'
        if (text === undefined) return 'Error: text is required for type action.'

        selector = resolveSelector(selector)
        log.info(`Typing "${text}" into: ${selector}`)
        await page.fill(selector, text)
        // Press Enter in case it's a search field
        try {
          await page.press(selector, 'Enter')
        } catch {}

        await page.waitForTimeout(1500)
        await updateBrowserState(page)

        const html = await page.content()
        const title = await page.title()
        const currentUrl = page.url()
        const markdown = cleanHtmlToMarkdown(html, currentUrl)
        const screenshot = latestBrowserState?.screenshot || ''

        return `Successfully typed and submitted.
URL: ${currentUrl}
Title: ${title}
Screenshot: ${screenshot}

--- Content (TokenJuice Compressed) ---
${markdown}`
      }

      if (action === 'scroll') {
        const direction = (args.direction as string) || 'down'
        log.info(`Scrolling: ${direction}`)
        
        if (direction === 'down') {
          await page.evaluate(() => (globalThis as any).scrollBy(0, 600))
        } else {
          await page.evaluate(() => (globalThis as any).scrollBy(0, -600))
        }

        await page.waitForTimeout(500)
        await updateBrowserState(page)

        const html = await page.content()
        const currentUrl = page.url()
        const markdown = cleanHtmlToMarkdown(html, currentUrl)
        const screenshot = latestBrowserState?.screenshot || ''

        return `Successfully scrolled ${direction}.
Screenshot: ${screenshot}

--- Content (TokenJuice Compressed) ---
${markdown}`
      }

      if (action === 'hover') {
        let selector = args.selector as string
        if (!selector) return 'Error: selector is required for hover action.'

        selector = resolveSelector(selector)
        log.info(`Hovering: ${selector}`)
        await page.hover(selector)
        await updateBrowserState(page)
        const screenshot = latestBrowserState?.screenshot || ''
        return `Successfully hovered over ${selector}. Screenshot: ${screenshot}`
      }

      if (action === 'back') {
        log.info('Going back in history')
        await page.goBack({ waitUntil: 'domcontentloaded' })
        await updateBrowserState(page)

        const html = await page.content()
        const title = await page.title()
        const currentUrl = page.url()
        const markdown = cleanHtmlToMarkdown(html, currentUrl)
        const screenshot = latestBrowserState?.screenshot || ''

        return `Successfully navigated back.
URL: ${currentUrl}
Title: ${title}
Screenshot: ${screenshot}

--- Content (TokenJuice Compressed) ---
${markdown}`
      }

      if (action === 'screenshot') {
        const screenshot = await takeScreenshot(page)
        return `Screenshot captured: ${screenshot}`
      }

      if (action === 'get_html') {
        const html = await page.content()
        return html
      }

      if (action === 'get_text') {
        const html = await page.content()
        const currentUrl = page.url()
        const markdown = cleanHtmlToMarkdown(html, currentUrl)
        return markdown
      }

      return `Error: Unknown action "${action}".`
    } catch (e) {
      log.error(`webBrowser error during ${action}:`, e)
      return `Error executing browser action "${action}": ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
