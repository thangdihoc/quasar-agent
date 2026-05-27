// tests/test-profile.ts

import { createUpdateUserProfileTool } from '../packages/tools/src/profile.js'
import { existsSync, unlinkSync, readFileSync } from 'fs'
import { resolve } from 'path'

async function runTest() {
  const filePath = resolve('./data/USER_PROFILE.md')
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }

  const tool = createUpdateUserProfileTool()
  console.log('--- Testing update_user_profile tool ---')

  const res1 = await tool({ key: 'coding_preference', value: 'TypeScript with Clean Architecture' })
  console.log('Result 1:', res1)

  const res2 = await tool({ key: 'work_hours', value: 'Late nights from 10 PM to 2 AM' })
  console.log('Result 2:', res2)

  // Update existing key
  const res3 = await tool({ key: 'coding_preference', value: 'TypeScript + Rust with clean code' })
  console.log('Result 3:', res3)

  if (existsSync(filePath)) {
    console.log('\n--- USER_PROFILE.md content ---')
    console.log(readFileSync(filePath, 'utf-8'))
  } else {
    console.log('Error: USER_PROFILE.md was not created')
    process.exit(1)
  }
}

runTest().catch(console.error)
