import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { defineConfig } from 'tsdown'

import { failOnUnresolvedImport, sourceConditionNames } from './shared.ts'

// This package sits at packages/tsdown-config, two levels below the repository, like apps/server.
const repoRoot = resolve(import.meta.dirname, '../..')

// The native pixel comparison (packages/diff/native, built by `@circi/diff`'s build script) loads
// from next to the bundle. Absent on a machine without Rust: the JS engine runs then.
const nativeDiff = join(repoRoot, 'packages/diff/native/circi-diff.node')

// `@circi/server` (apps/server): one bundle for the Docker image. What stays external is exactly this package's `dependencies`
// (sharp, pg and the AWS SDK: see deploy/README.md for why); everything else, our workspace
// packages included, is inlined from source.
export default defineConfig({
  // The second entry is the `js-workers` diff engine's thread script: a worker needs its own file,
  // which packages/diff finds next to the bundle (dist/pool-worker.mjs); from source it uses the .ts.
  entry: {
    main: 'src/main.ts',
    'pool-worker': '../../packages/diff/src/pool-worker.ts',
  },
  platform: 'node',
  dts: false,
  sourcemap: true,
  // The server-rendered pages' stylesheet: pages.ts reads it next to itself in the source and next
  // to the bundle here (the image copies all of dist).
  copy: ({ outDir }) => [
    { from: 'src/http/lib/standalone-page.css', to: outDir },
    ...(existsSync(nativeDiff) ? [{ from: nativeDiff, to: outDir }] : []),
  ],
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
    resolve: { conditionNames: sourceConditionNames },
    onLog: failOnUnresolvedImport,
  },
})
