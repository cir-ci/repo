/**
 * Pieces the four `tsdown.config.ts` files (apps/server, packages/{cli,vitest,ui}) share. Each
 * config spreads or calls what it needs and adds what is its own.
 */
/** Rolldown's default conditions are replaced when this is set; `@circi/source` leads to `src/*.ts`. */
export declare const sourceConditionNames: string[]
/**
 * A dependency that fails to resolve would otherwise become a bare import that breaks at runtime
 * (or in a published package): make it a build error.
 */
export declare function failOnUnresolvedImport<
  Log extends {
    code?: string
  },
>(
  level: 'info' | 'debug' | 'warn',
  log: Log,
  handler: (level: 'info' | 'debug' | 'warn' | 'error', log: Log) => void,
): void
/** The published Node packages (`@circi/cli`, `@circi/vitest`): ESM with types, linted for publishing. */
export declare const publishedNodePackage: {
  readonly platform: 'node'
  readonly sourcemap: true
  readonly dts: true
  readonly publint: true
  readonly attw: {
    readonly profile: 'esm-only'
  }
}
