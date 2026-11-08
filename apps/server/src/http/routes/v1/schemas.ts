import { COMMIT_SHA_RE, MAX_ANCESTORS, MAX_PARALLEL_SHARDS, SHA256_RE } from '@circi/core'
import { z } from 'zod'

/** Request schemas for the CI API (`/v1`). Handlers parse with these via `parse()`. */

/** Largest screenshot accepted (PLAN §7.1). Full-page captures of long pages can be big. */
export const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024
export const MAX_FILES_PER_BUILD = 10_000
/** Body limit for the JSON endpoints that list every screenshot of a build. */
export const JSON_BODY_LIMIT = 16 * 1024 * 1024

const sha256 = z.string().regex(SHA256_RE, 'must be a lowercase hex sha256')
const commitSha = z.string().regex(COMMIT_SHA_RE, 'must be a commit SHA')

/** Who made the change, as the CI reports it. Matching it to a member is the service's job. */
export const authorBody = z.object({
  login: z.string().trim().min(1).max(255).nullish(),
  email: z.string().trim().min(1).max(320).nullish(),
  provider: z.string().min(1).max(64).optional(),
  providerId: z.string().min(1).max(128).nullish(),
})

export const createBuildBody = z.object({
  author: authorBody.optional(),
  name: z.string().optional(),
  commitSha,
  branch: z.string().max(255).nullish(),
  prNumber: z.number().int().positive().nullish(),
  baseBranch: z.string().max(255).nullish(),
  mergeBaseSha: commitSha.nullish(),
  ancestorShas: z.array(commitSha).max(MAX_ANCESTORS).optional(),
  ancestryStatus: z.enum(['ok', 'missing', 'truncated']).optional(),
  parallel: z
    .object({
      nonce: z.string().min(1).max(128),
      total: z.number().int().min(1).max(MAX_PARALLEL_SHARDS),
    })
    .optional(),
  files: z
    .array(
      z.object({
        sha256,
        size: z.number().int().positive().max(MAX_SCREENSHOT_BYTES),
        contentType: z.literal('image/png'),
      }),
    )
    .max(MAX_FILES_PER_BUILD),
})

export const finalizeBody = z.object({
  shardIndex: z.string().min(1).max(128).optional(),
  screenshots: z
    .array(
      z.object({
        name: z.string().min(1).max(512),
        sha256,
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(MAX_FILES_PER_BUILD),
})

export const buildIdParams = z.object({ id: z.uuid() })
export const fileParams = z.object({ sha256 })
