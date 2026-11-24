import { defineConfig } from 'tsdown'

import { bundlesCli } from './shared.ts'

/** `@circi/vitest` (packages/vitest): the Vitest plugin, its browser half and setup file. */
export default defineConfig({
  entry: ['src/index.ts', 'src/browser.ts', 'src/setup.ts'],
  ...bundlesCli,
})
