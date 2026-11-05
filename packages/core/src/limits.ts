import { ValidationError } from './errors.ts'

/**
 * The rules a CI upload's input must follow, in one place. The HTTP schemas and the database
 * layer both use them, so a limit can't be changed in one and forgotten in the other.
 */

export const COMMIT_SHA_RE = /^[0-9a-fA-F]{7,64}$/
export const SHA256_RE = /^[0-9a-f]{64}$/
export const BUILD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Most ancestor commits a build may list for baseline resolution. */
export const MAX_ANCESTORS = 2_000
/** Most shards one parallel build may be split into. */
export const MAX_PARALLEL_SHARDS = 1_000

export const isCommitSha = (value: string): boolean => COMMIT_SHA_RE.test(value)
export const isSha256 = (value: string): boolean => SHA256_RE.test(value)

/** Validated, lowercased build input; throws `ValidationError` naming what's wrong. */
export function checkBuildInput(input: {
  name?: string | undefined
  commitSha: string
  ancestorShas?: readonly string[] | undefined
  parallelTotal?: number | undefined
}): { name: string; commitSha: string; ancestorShas: string[] } {
  const name = input.name ?? 'default'
  if (!BUILD_NAME_RE.test(name)) {
    throw new ValidationError(
      `Invalid build name "${name}": use letters, digits, ".", "_" or "-" (max 64)`,
    )
  }
  if (!isCommitSha(input.commitSha)) {
    throw new ValidationError(`Invalid commit SHA "${input.commitSha}"`)
  }
  const ancestorShas = (input.ancestorShas ?? []).map((s) => s.toLowerCase())
  if (ancestorShas.length > MAX_ANCESTORS || !ancestorShas.every(isCommitSha)) {
    throw new ValidationError(`ancestorShas must be at most ${MAX_ANCESTORS} commit SHAs`)
  }
  if (
    input.parallelTotal !== undefined &&
    (input.parallelTotal < 1 || input.parallelTotal > MAX_PARALLEL_SHARDS)
  ) {
    throw new ValidationError(`parallel.total must be between 1 and ${MAX_PARALLEL_SHARDS}`)
  }
  return { name, commitSha: input.commitSha.toLowerCase(), ancestorShas }
}
