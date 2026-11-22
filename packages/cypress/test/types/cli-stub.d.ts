// A stand-in for the `@circi/cli` root in this package's browser-typed program (its sources don't
// compile with the DOM library); the real types are checked by the root typecheck. The browser
// side imports only `@circi/cli/names`, which has no imports and is resolved for real.
export declare namespace CirciOptions {
  interface Common {
    apiUrl?: string
    token?: string
    name?: string
    dir?: string
    clean?: boolean
    root?: string
    wait?: boolean
    strict?: boolean
    shard?: { index: number; total: number; nonce?: string }
    log?: (line: string) => void
  }
}
export declare namespace upload {
  interface Options {
    dir: string
    [key: string]: unknown
  }
  interface Result {
    exitCode: 0 | 1 | 2
  }
}
export declare function uploadCaptures(
  options: Record<string, unknown>,
): Promise<{ status: string; exitCode: 0 | 1 | 2 }>
export declare function writeCapture(
  file: string,
  png: Uint8Array,
  metadata?: Record<string, unknown>,
): Promise<void>
export declare function shardFromEnv(
  env: Record<string, string | undefined>,
): { index: number; total: number } | undefined
export declare function errorLine(err: unknown): string
