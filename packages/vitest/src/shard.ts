import { parseShard } from '@circi/cli'

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
    const shard = value ? parseShard(value) : undefined
    if (shard) return shard
  }
  return undefined
}
