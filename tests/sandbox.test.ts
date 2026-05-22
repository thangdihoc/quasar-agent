// tests/sandbox.test.ts
// Unit tests for Code Interpreter Sandbox Security

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createRunCodeTool } from '../packages/tools/src/sandbox.js'

describe('Code Interpreter Sandbox Security', () => {
  const runCode = createRunCodeTool()
  let originalEnv: Record<string, string | undefined>

  beforeAll(() => {
    // Backup original env and mock sensitive variables
    originalEnv = { ...process.env }
    process.env.OPENAI_API_KEY = 'sk-proj-testkey123'
    process.env.GEMINI_API_KEY = 'gemini-key-xyz'
    process.env.MY_SECRET_PASSWORD = 'super-secret-password-123'
    process.env.TELEGRAM_BOT_TOKEN = '123456:ABC-DEF'
  })

  afterAll(() => {
    // Restore original env
    process.env = originalEnv
  })

  test('should execute simple calculations successfully in javascript', async () => {
    const result = await runCode({
      language: 'javascript',
      code: 'console.log(2 + 2);',
    })
    expect(result).toContain('Output:')
    expect(result).toContain('4')
    expect(result).toContain('Exit code: 0')
  })

  test('should block/filter sensitive environment variables in sandbox', async () => {
    // We execute code that tries to print environment variables
    const result = await runCode({
      language: 'javascript',
      code: 'console.log(JSON.stringify(process.env));',
    })

    expect(result).toContain('Output:')
    // The outputs should NOT contain our secret keys
    expect(result).not.toContain('sk-proj-testkey123')
    expect(result).not.toContain('gemini-key-xyz')
    expect(result).not.toContain('super-secret-password-123')
    expect(result).not.toContain('123456:ABC-DEF')
    
    // Whitelisted variables like PATH or OS should still be allowed if present
    // process.env contains them in host, let's verify cleanEnv filtered them properly
    expect(result).not.toContain('OPENAI_API_KEY')
    expect(result).not.toContain('GEMINI_API_KEY')
    expect(result).not.toContain('MY_SECRET_PASSWORD')
  })

  test('should execute simple python code and also strip variables', async () => {
    const result = await runCode({
      language: 'python',
      code: `
import os
import json
print("Output is:", json.dumps(dict(os.environ)))
      `,
    })

    expect(result).toContain('Output:')
    expect(result).not.toContain('sk-proj-testkey123')
    expect(result).not.toContain('gemini-key-xyz')
    expect(result).not.toContain('super-secret-password-123')
  })
})
