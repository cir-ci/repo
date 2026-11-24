import { defineConfig } from 'tsdown'

import { bundlesCli } from './shared.ts'

/** `@circi/storybook` (packages/storybook): the `circi-storybook` command and its preset. */
export default defineConfig({
  entry: ['src/index.ts', 'src/main.ts', 'src/preset.ts'],
  ...bundlesCli,
})
