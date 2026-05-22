// scripts/test-playwright.ts
// Test script for Playwright Browser Tool and TokenJuice compression

import { webBrowser } from '../packages/tools/src/web/browser.js'

async function runTest() {
  console.log('🚀 Starting Playwright Browser Tool test...')

  // Test 1: Navigation to Hacker News in headed or headless mode
  // Using headless: true for automated script running
  console.log('\n--- Test 1: Navigating to Hacker News ---')
  const result1 = await webBrowser({
    action: 'navigate',
    url: 'https://news.ycombinator.com',
    headless: true
  })

  console.log('Result 1 length:', result1.length)
  
  if (result1.includes('Successfully loaded page') && result1.includes('news.ycombinator.com')) {
    console.log('✅ Navigation test passed!')
  } else {
    console.error('❌ Navigation test failed. Result:', result1)
    process.exit(1)
  }

  // Verify that it contains Markdown formatted text instead of raw HTML
  if (result1.includes('--- Content (TokenJuice Compressed) ---')) {
    console.log('✅ TokenJuice Compression detected!')
    const textStart = result1.indexOf('--- Content (TokenJuice Compressed) ---')
    console.log('\nSnippet of compressed output:')
    console.log(result1.substring(textStart, textStart + 500))
  } else {
    console.error('❌ TokenJuice section missing!')
    process.exit(1)
  }

  // Test 2: Close browser
  console.log('\n--- Test 2: Closing Browser ---')
  const result2 = await webBrowser({
    action: 'close'
  })
  console.log('Result 2:', result2)
  if (result2.includes('Browser closed successfully')) {
    console.log('✅ Close browser test passed!')
  } else {
    console.error('❌ Close browser test failed. Result:', result2)
    process.exit(1)
  }

  console.log('\n🎉 ALL PLAYWRIGHT BROWSER TESTS PASSED!')
}

runTest().catch((e) => {
  console.error('❌ Test failed with error:', e)
  process.exit(1)
})
