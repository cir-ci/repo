import { existsSync, readFileSync } from 'node:fs'

/**
 * Pieces the build configs in this package share (tsdown.<package>.ts). Each one spreads or calls
 * what it needs and adds what is its own.
 */

/** Rolldown's default conditions are replaced when this is set; `@circi/source` leads to `src/*.ts`. */
export const sourceConditionNames = ['@circi/source', 'import', 'node', 'default']

/**
 * A dependency that fails to resolve would otherwise become a bare import that breaks at runtime
 * (or in a published package): make it a build error.
 */
export function failOnUnresolvedImport<Log extends { code?: string }>(
  level: 'info' | 'debug' | 'warn',
  log: Log,
  handler: (level: 'info' | 'debug' | 'warn' | 'error', log: Log) => void,
): void {
  handler(log.code === 'UNRESOLVED_IMPORT' ? 'error' : level, log)
}

/** The published Node packages (`@circi/cli`, `@circi/vitest`, `@circi/storybook`, `@circi/cypress`): ESM with types, linted for publishing. */
export const publishedNodePackage = {
  platform: 'node',
  sourcemap: true,
  dts: true,
  publint: true,
  attw: { profile: 'esm-only' },
} as const

/**
 * `@circi/cli` is inlined from its built `dist`; hand Rolldown that file's own source map so the
 * bundle's leads to the TypeScript rather than to the built chunk (which isn't published). For the
 * packages that bundle the CLI: `@circi/vitest`, `@circi/storybook` and `@circi/cypress`.
 */
export const inlinedCliSourceMaps = {
  name: 'circi-cli-source-maps',
  load(id: string) {
    const isCliChunk = /\/packages\/cli\/dist\/.+\.mjs$/.test(id)
    if (!isCliChunk || !existsSync(`${id}.map`)) return null
    return { code: readFileSync(id, 'utf8'), map: readFileSync(`${id}.map`, 'utf8') }
  },
}

/** The build of a published package that inlines `@circi/cli` (see `inlinedCliSourceMaps`). */
export const bundlesCli = {
  ...publishedNodePackage,
  plugins: [inlinedCliSourceMaps],
  inputOptions: {
    // `@circi/cli` is a devDependency inlined from its built `dist`: if that isn't built, Rolldown
    // would leave the import external and publish a package that can't load.
    onLog: failOnUnresolvedImport,
  },
}
