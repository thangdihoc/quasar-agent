// scripts/doctor.ts — Health check script

import { createLogger } from '@quasar/core'
import { existsSync } from 'fs'
import { resolve } from 'path'

const log = createLogger('doctor')

interface Check {
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = []

  // 1. Node.js version
  const nodeVersion = process.version
  const major = parseInt(nodeVersion.slice(1))
  checks.push({
    name: 'Node.js',
    status: major >= 20 ? 'pass' : 'fail',
    message: `${nodeVersion} ${major >= 20 ? '✅' : '❌ (need v20+)'}`,
  })

  // 2. .env file
  const envExists = existsSync(resolve('.env'))
  checks.push({
    name: '.env file',
    status: envExists ? 'pass' : 'warn',
    message: envExists ? 'Found ✅' : 'Not found ⚠️ (copy from .env.example)',
  })

  // 3. Environment variables
  const vars = ['TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY']
  for (const v of vars) {
    const value = process.env[v]
    checks.push({
      name: v,
      status: value ? 'pass' : v === 'TELEGRAM_BOT_TOKEN' ? 'fail' : 'warn',
      message: value ? 'Set ✅' : 'Not set ⚠️',
    })
  }

  // 4. Data directory
  const dataDir = resolve('./data')
  checks.push({
    name: 'Data directory',
    status: existsSync(dataDir) ? 'pass' : 'warn',
    message: existsSync(dataDir) ? 'Exists ✅' : 'Will be created on first run',
  })

  // 5. Python (for Computer Use)
  try {
    const { execSync } = await import('child_process')
    const pyVersion = execSync('python --version 2>&1', { encoding: 'utf-8' }).trim()
    checks.push({
      name: 'Python',
      status: 'pass',
      message: `${pyVersion} ✅`,
    })
  } catch {
    checks.push({
      name: 'Python',
      status: 'warn',
      message: 'Not found ⚠️ (needed for Computer Use module)',
    })
  }

  // 6. Rust (for native modules)
  try {
    const { execSync } = await import('child_process')
    const rustVersion = execSync('rustc --version 2>&1', { encoding: 'utf-8' }).trim()
    checks.push({
      name: 'Rust',
      status: 'pass',
      message: `${rustVersion} ✅`,
    })
  } catch {
    checks.push({
      name: 'Rust',
      status: 'warn',
      message: 'Not found ⚠️ (needed for native performance modules)',
    })
  }

  return checks
}

async function main() {
  console.log('\n🔍 Quasar Doctor — Health Check\n')
  console.log('─'.repeat(50))

  const checks = await runChecks()
  const maxName = Math.max(...checks.map(c => c.name.length))

  for (const check of checks) {
    const pad = ' '.repeat(maxName - check.name.length)
    console.log(`  ${check.name}${pad}  ${check.message}`)
  }

  console.log('─'.repeat(50))

  const fails = checks.filter(c => c.status === 'fail')
  const warns = checks.filter(c => c.status === 'warn')

  if (fails.length > 0) {
    console.log(`\n❌ ${fails.length} critical issue(s) found.`)
  } else if (warns.length > 0) {
    console.log(`\n⚠️ All critical checks passed, ${warns.length} warning(s).`)
  } else {
    console.log('\n✅ All checks passed! Ready to run.')
  }
  console.log('')
}

main()
