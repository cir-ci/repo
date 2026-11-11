import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import pixelmatch from 'pixelmatch'

/**
 * The pixel comparison behind `diffImages`: pixelmatch in JavaScript (`js`, the default) or the
 * Rust port in `packages/diff/native` (`native`). sharp still decodes and encodes either way.
 * The caller picks the engine (the server reads `CIRCI_DIFF_ENGINE` through `@circi/config`);
 * nothing here reads the environment.
 */
export type DiffEngine = 'js' | 'native'

export namespace comparePixels {
  export interface Options {
    /** Per-pixel colour tolerance (0-1). */
    threshold: number
    /** Opacity of the original in the diff image. */
    alpha?: number
    /** Draw the diff image; without it only the count is computed. */
    withOutput: boolean
  }

  export interface Result {
    changedPixels: number
    /** RGBA, width x height x 4 bytes; only with `withOutput`. */
    output?: Uint8Array
  }
}

interface NativeModule {
  compareAsync(
    a: Uint8Array,
    b: Uint8Array,
    width: number,
    height: number,
    options: { threshold: number; includeAa: boolean; alpha: number; withOutput: boolean },
  ): Promise<{ changedPixels: number; output?: Uint8Array | null }>
}

/** Where the compiled addon may be: next to the server bundle (the image), or in the package's crate folder. */
const NATIVE_CANDIDATES = [
  new URL('./circi-diff.node', import.meta.url),
  new URL('../native/circi-diff.node', import.meta.url),
]

function isNativeModule(value: unknown): value is NativeModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'compareAsync' in value &&
    typeof value.compareAsync === 'function'
  )
}

type Loaded = { module: NativeModule; path: string } | { error: string }
let loaded: Loaded | undefined

function load(): Loaded {
  if (loaded) return loaded
  const require = createRequire(import.meta.url)
  const found = NATIVE_CANDIDATES.map((u) => fileURLToPath(u)).filter((p) => existsSync(p))
  if (found.length === 0) {
    return (loaded = {
      error: `no circi-diff.node next to the bundle or in packages/diff/native (build it with cargo: pnpm --filter @circi/diff build)`,
    })
  }
  const errors: string[] = []
  for (const path of found) {
    try {
      const module: unknown = require(path)
      if (!isNativeModule(module)) throw new Error('not the circi diff addon')
      return (loaded = { module, path })
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return (loaded = { error: errors.join('; ') })
}

/** Whether the native addon loads on this machine (platform, architecture and glibc included). */
export function nativeEngineStatus():
  | { available: true; path: string }
  | { available: false; reason: string } {
  const l = load()
  return 'module' in l ? { available: true, path: l.path } : { available: false, reason: l.error }
}

/**
 * The engine that will actually run for the requested one: `native` falls back to `js` when the
 * addon can't load, and `warn` is told why (the caller calls this once at startup, so the
 * warning appears once). Never throws.
 */
export function resolveDiffEngine(
  requested: DiffEngine,
  warn?: (message: string) => void,
): DiffEngine {
  if (requested !== 'native') return 'js'
  const status = nativeEngineStatus()
  if (status.available) return 'native'
  warn?.(
    `CIRCI_DIFF_ENGINE=native but the native addon can't load (${status.reason}); using the JS engine`,
  )
  return 'js'
}

/** Compares two equally sized RGBA canvases with the chosen engine (`native` without an addon runs `js`). */
export async function comparePixels(
  engine: DiffEngine,
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  options: comparePixels.Options,
): Promise<comparePixels.Result> {
  const alpha = options.alpha ?? 0.1
  const l = engine === 'native' ? load() : undefined
  if (l && 'module' in l) {
    const res = await l.module.compareAsync(a, b, width, height, {
      threshold: options.threshold,
      includeAa: false,
      alpha,
      withOutput: options.withOutput,
    })
    return {
      changedPixels: res.changedPixels,
      ...(res.output ? { output: res.output } : {}),
    }
  }
  const output = options.withOutput ? new Uint8Array(width * height * 4) : undefined
  const changedPixels = pixelmatch(a, b, output, width, height, {
    threshold: options.threshold,
    includeAA: false,
    alpha,
  })
  return { changedPixels, ...(output ? { output } : {}) }
}
