import { defineConfig } from 'tsdown'

import { bundlesCli } from './shared.ts'

/** `@circi/cypress` (packages/cypress): the plugin and its support file. */
export default defineConfig({
  entry: ['src/index.ts', 'src/support.ts'],
  ...bundlesCli,
})
