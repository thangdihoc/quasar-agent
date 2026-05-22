import { chromium } from 'playwright'

async function run() {
  console.log('Starting screenshot script...')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })

  console.log('Navigating to WebChat UI http://127.0.0.1:18789...')
  try {
    await page.goto('http://127.0.0.1:18789', { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'C:/Users/mz/.gemini/antigravity-ide/brain/b642ddd1-cb3d-4a55-b5a2-1ea566c6dc1c/dashboard.png' })
    console.log('Screenshot of WebChat UI saved successfully!')
  } catch (e) {
    console.error('Failed to capture WebChat UI:', e)
  }

  console.log('Navigating to Admin Dashboard http://127.0.0.1:18789/admin...')
  try {
    await page.goto('http://127.0.0.1:18789/admin', { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'C:/Users/mz/.gemini/antigravity-ide/brain/b642ddd1-cb3d-4a55-b5a2-1ea566c6dc1c/admin.png' })
    console.log('Screenshot of Admin Dashboard saved successfully!')
  } catch (e) {
    console.error('Failed to capture Admin Dashboard:', e)
  }

  await browser.close()
  console.log('Done!')
}

run().catch(console.error)
