// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@quasar/core': resolve(__dirname, 'packages/core/src'),
      '@quasar/agent': resolve(__dirname, 'packages/agent/src'),
      '@quasar/memory': resolve(__dirname, 'packages/memory/src'),
      '@quasar/tools': resolve(__dirname, 'packages/tools/src'),
    },
  },
})
