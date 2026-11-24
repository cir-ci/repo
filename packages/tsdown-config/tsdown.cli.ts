import { defineConfig } from 'tsdown'

import { publishedNodePackage } from './shared.ts'

/** `@circi/cli` (packages/cli): the `circi` command and the API the plugins build on. */
export default defineConfig({
  entry: ['src/index.ts', 'src/main.ts', 'src/names.ts'],
  ...publishedNodePackage,
})
