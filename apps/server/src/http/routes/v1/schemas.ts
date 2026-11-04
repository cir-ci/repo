import { z } from 'zod'

/** Request schemas for the CI API (`/v1`). Handlers parse with these via `parse()`. */

/** Largest screenshot accepted (PLAN §7.1). Full-page captures of long pages can be big. */
export const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024
export const MAX_FILES_PER_BUILD = 10_000
/** Body limit for the JSON endpoints that list every screenshot of a build. */
export const JSON_BODY_LIMIT = 16 * 1024 * 1024

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256')
const commitSha = z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'must be a commit SHA')

export const createBuildBody = z.object({
  name: z.string().optional(),
  commitSha,
  branch: z.string().max(255).nullish(),
  prNumber: z.number().int().positive().nullish(),
  baseBranch: z.string().max(255).nullish(),
  mergeBaseSha: commitSha.nullish(),
  ancestorShas: z.array(commitSha).max(2_000).optional(),
  ancestryStatus: z.enum(['ok', 'missing', 'truncated']).optional(),
  parallel: z
    .object({ nonce: z.string().min(1).max(128), total: z.number().int().min(1).max(1_000) })
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
