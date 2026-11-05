/** Vitest's `--shard=2/4` is 1-based like CirCI's `--shard`; this reads it from the command line. */

export interface Shard {
  /** 0-based. */
  index: number
  total: number
}

export function shardFromArgs(argv: readonly string[]): Shard | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    const value = arg.startsWith('--shard=')
      ? arg.slice('--shard='.length)
      : arg === '--shard'
        ? argv[i + 1]
        : undefined
    const m = value ? /^(\d+)\/(\d+)$/.exec(value) : null
    if (m?.[1] && m[2]) {
      const index = Number(m[1]) - 1
      const total = Number(m[2])
      if (total >= 1 && index >= 0 && index < total) return { index, total }
    }
  }
  return undefined
}
