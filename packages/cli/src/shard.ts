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
