import { defineConfig } from 'tsdown'

import { publishedNodePackage } from '../../tsdown.shared.ts'

export default defineConfig({
  entry: ['src/index.ts', 'src/main.ts', 'src/names.ts'],
  ...publishedNodePackage,
})
