import { UsageError } from './errors.ts'
import type { CirciOptions } from './options.ts'

/**
 * `2/4` → the second of four jobs, 0-based (`{ index: 1, total: 4 }`); undefined unless it's a
 * job number from 1 to the total. Read the same way by `circi upload --shard` and Vitest's `--shard`.
 */
export function parseShard(text: string): { index: number; total: number } | undefined {
  const m = /^(\d+)\/(\d+)$/.exec(text.trim())
  if (!m?.[1] || !m[2]) return undefined
  const index = Number(m[1]) - 1
  const total = Number(m[2])
  return total >= 1 && index >= 0 && index < total ? { index, total } : undefined
}

/** The value of a `--shard` flag (and `--nonce`), or a usage error saying how to write it. */
export function shardFlag(text: string, nonce?: string): CirciOptions.Shard {
  const shard = parseShard(text)
  if (!shard) {
    throw new UsageError(
      "--shard must look like 1/4: this job's number, then how many jobs there are",
    )
  }
  return { ...shard, ...(nonce ? { nonce } : {}) }
}

/** Vitest's `--shard=2/4` or `--shard 2/4` (1-based like CirCI's) from a command line. */
export function shardFromArgs(argv: readonly string[]): CirciOptions.Shard | undefined {
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

/** `CIRCI_SHARD=2/4` from the environment, for runners that have no `--shard` of their own. */
export function shardFromEnv(
  env: Record<string, string | undefined>,
): CirciOptions.Shard | undefined {
  const value = env.CIRCI_SHARD
  return value ? parseShard(value) : undefined
}
