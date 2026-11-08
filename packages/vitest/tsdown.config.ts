import { existsSync, readFileSync } from 'node:fs'

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/browser.ts'],
  platform: 'node',
  sourcemap: true,
  dts: true,
  publint: true,
  attw: { profile: 'esm-only' },
  plugins: [
    {
      // `@circi/cli` is inlined from its built `dist`; hand Rolldown that file's own source map so
      // ours leads to the TypeScript rather than to the built chunk (which isn't published).
      name: 'circi-cli-source-maps',
      load(id) {
        const isCliChunk = /\/packages\/cli\/dist\/.+\.mjs$/.test(id)
        if (!isCliChunk || !existsSync(`${id}.map`)) return null
        return { code: readFileSync(id, 'utf8'), map: readFileSync(`${id}.map`, 'utf8') }
      },
    },
  ],
  inputOptions: {
    // `@circi/cli` is a devDependency inlined from its built `dist`: if that isn't built, Rolldown
    // would leave the import external and publish a package that can't load.
    onLog(level, log, handler) {
      handler(log.code === 'UNRESOLVED_IMPORT' ? 'error' : level, log)
    },
  },
})
