import { dirname, join, relative, resolve } from 'node:path'

import { defineConfig } from 'tsdown'

const repoRoot = resolve(import.meta.dirname, '../..')

// One bundle for the Docker image. What stays external is exactly this package's `dependencies`
// (sharp, pg and the AWS SDK: see deploy/README.md for why); everything else, our workspace
// packages included, is inlined from source.
export default defineConfig({
  entry: ['src/main.ts'],
  platform: 'node',
  dts: false,
  sourcemap: true,
  outputOptions: {
    // Stack traces resolve `sources` against the bundle's own folder, which is /app/dist in the
    // image but apps/server/dist in the repo. Write them relative to the repo root, one level up
    // from `dist`, so they read /app/apps/server/src/... and /app/packages/db/src/... there.
    sourcemapPathTransform: (source, mapPath) =>
      join('..', relative(repoRoot, resolve(dirname(mapPath), source))),
  },
  inputOptions: {
    // Resolve workspace packages to their TypeScript, so the bundle needs no built `dist` and its
    // source maps lead to the real files. Rolldown replaces its default conditions when this is set.
    resolve: { conditionNames: ['@circi/source', 'import', 'node', 'default'] },
    // A dependency that fails to resolve would otherwise become a bare import that breaks at runtime.
    onLog(level, log, handler) {
      handler(log.code === 'UNRESOLVED_IMPORT' ? 'error' : level, log)
    },
  },
})
