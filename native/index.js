import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const native = require('./quasar-native.node')

export const countTokens = native.countTokens
export const createDiff = native.createDiff
export const applyPatch = native.applyPatch
export const compactContext = native.compactContext
