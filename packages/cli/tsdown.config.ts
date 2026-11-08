import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/main.ts'],
  platform: 'node',
  sourcemap: true,
  dts: true,
  publint: true,
  attw: { profile: 'esm-only' },
})
