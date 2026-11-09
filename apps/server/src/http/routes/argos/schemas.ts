import { COMMIT_SHA_RE } from '@circi/core'
import { z } from 'zod'

export const JSON_LIMIT = 4 * 1024 * 1024

export const baselineBody = z.object({
  commits: z.array(z.string()).max(2_000),
  name: z.string().optional(),
})

export const createBody = z.object({
  /** Not part of Argos's API; an SDK or script may send the author's login. */
  author: z.string().trim().min(1).max(255).nullish(),
  commit: z.string().regex(COMMIT_SHA_RE, 'must be a commit SHA'),
  branch: z.string().max(255).nullish(),
  name: z.string().nullish(),
  parallel: z.boolean().nullish(),
  parallelNonce: z.string().min(1).max(128).nullish(),
  prNumber: z.number().int().positive().nullish(),
  referenceBranch: z.string().max(255).nullish(),
  referenceCommit: z.string().nullish(),
  parentCommits: z.array(z.string()).max(2_000).nullish(),
  screenshots: z
    .array(z.object({ key: z.string(), contentType: z.string().optional() }))
    .max(10_000),
})

export const updateBody = z.object({
  screenshots: z
    .array(
      z.object({
        key: z.string(),
        name: z.string().min(1).max(512),
        metadata: z.record(z.string(), z.unknown()).nullish(),
      }),
    )
    .max(10_000),
  parallel: z.boolean().nullish(),
  parallelTotal: z.number().int().nullish(),
  parallelIndex: z.number().int().nullish(),
  final: z.boolean().nullish(),
})

/** Argos build names are free text; ours are short identifiers. */
export function buildName(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
  return cleaned || undefined
}
