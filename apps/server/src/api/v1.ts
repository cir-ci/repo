import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { buildOutcome, hashToken, looksLikeProjectToken, ValidationError } from '@circi/core'
import {
  ConflictError,
  createBuild,
  type Database,
  finalizeBuild,
  findProjectByTokenHash,
  getBuildCounts,
  getFile,
  getProjectBuild,
  getProjectContext,
  markFileVerified,
  NotFoundError,
  planUploads,
  type ProjectContext,
} from '@circi/db'
import { ChecksumMismatchError, contentKey, type StorageDriver } from '@circi/storage'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

/** Largest screenshot accepted (PLAN §7.1). Full-page captures of long pages can be big. */
export const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024
const MAX_FILES_PER_BUILD = 10_000
const JSON_BODY_LIMIT = 16 * 1024 * 1024

export interface V1Deps {
  db: Database
  storage: StorageDriver
  /** Dashboard origin (`PUBLIC_URL`), used for build links and local-disk upload URLs. */
  publicOrigin: string
}

declare module 'fastify' {
  interface FastifyRequest {
    project?: ProjectContext
  }
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256')
const commitSha = z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'must be a commit SHA')

const createBuildBody = z.object({
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

const finalizeBody = z.object({
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

const idParams = z.object({ id: z.uuid() })
const shaParams = z.object({ sha256 })

export function registerV1(app: FastifyInstance, deps: V1Deps): void {
  void app.register(
    async (v1) => {
      v1.addHook('onRequest', async (req, reply) => {
        const project = await authenticate(deps.db, req)
        if (!project) {
          return reply
            .code(401)
            .header('www-authenticate', 'Bearer')
            .send({ error: 'A valid project token is required (Authorization: Bearer circi_…)' })
        }
        req.project = project
        return undefined
      })

      // Uploaded file bodies are passed to the handler as a raw stream.
      v1.addContentTypeParser(['image/png', 'application/octet-stream'], (_req, payload, done) => {
        done(null, payload)
      })

      v1.setErrorHandler((err, req, reply) => sendError(err, req, reply))

      v1.get('/project', async (req) => {
        const { project, orgSlug } = requireProject(req)
        return {
          org: orgSlug,
          slug: project.slug,
          name: project.name,
          defaultBranch: project.defaultBranch,
          dashboardUrl: `${deps.publicOrigin}/${orgSlug}/${project.slug}`,
        }
      })

      v1.post('/builds', { bodyLimit: JSON_BODY_LIMIT }, async (req, reply) => {
        const ctx = requireProject(req)
        const body = parse(createBuildBody, req.body)
        const build = await createBuild(deps.db, {
          projectId: ctx.project.id,
          commitSha: body.commitSha,
          ...(body.name ? { name: body.name } : {}),
          branch: body.branch ?? null,
          prNumber: body.prNumber ?? null,
          baseBranch: body.baseBranch ?? null,
          mergeBaseSha: body.mergeBaseSha ?? null,
          ...(body.ancestorShas ? { ancestorShas: body.ancestorShas } : {}),
          ...(body.ancestryStatus ? { ancestryStatus: body.ancestryStatus } : {}),
          ...(body.parallel ? { parallel: body.parallel } : {}),
        })
        const planned = await planUploads(deps.db, {
          buildId: build.id,
          kind: 'screenshot',
          files: body.files,
          storageKeyFor: (s) => contentKey(s),
        })
        const uploads = await Promise.all(
          planned.map(async (p) => {
            if (deps.storage.presignPut) {
              const signed = await deps.storage.presignPut(p.storageKey, {
                sha256: p.sha256,
                contentLength: p.size,
                contentType: p.contentType,
              })
              return {
                sha256: p.sha256,
                url: signed.url,
                method: signed.method,
                headers: signed.headers,
                auth: 'none' as const,
              }
            }
            return {
              sha256: p.sha256,
              url: `${deps.publicOrigin}/v1/files/${p.sha256}`,
              method: 'PUT' as const,
              headers: { 'content-type': p.contentType },
              // Local-disk uploads go through the API, so the CLI sends its token with them.
              auth: 'token' as const,
            }
          }),
        )
        return reply.code(201).send({
          build: describeBuild(ctx, build, deps.publicOrigin),
          uploads,
        })
      })

      v1.put('/files/:sha256', async (req, reply) => {
        const { sha256: hash } = parse(shaParams, req.params)
        const file = await getFile(deps.db, hash)
        if (!file) {
          return reply
            .code(404)
            .send({ error: 'This file was not requested by any build (POST /v1/builds first)' })
        }
        const body = req.body
        if (!(body instanceof Readable)) {
          return reply
            .code(415)
            .send({ error: 'Send the file as image/png or application/octet-stream' })
        }
        if (file.status === 'verified') {
          body.resume() // Already have it; drain and succeed.
          return reply.code(200).send({ sha256: hash, status: 'verified' })
        }
        // pipeline (not .pipe) so a client abort or an oversized body also destroys `limited`,
        // which makes storage.put fail and discard its temporary file.
        const limited = byteLimit(MAX_SCREENSHOT_BYTES)
        pipeline(body, limited).catch(() => {})
        try {
          const result = await deps.storage.put(file.storageKey, limited, {
            expectedSha256: hash,
            contentType: file.contentType ?? 'image/png',
          })
          await markFileVerified(deps.db, hash, { size: result.size })
          return reply.code(201).send({ sha256: hash, status: 'verified' })
        } catch (err) {
          if (err instanceof ChecksumMismatchError) {
            return reply
              .code(422)
              .send({ error: `The uploaded bytes hash to ${err.actual}, not ${hash}` })
          }
          if (err instanceof TooLargeError) {
            return reply
              .code(413)
              .send({ error: `Files are limited to ${MAX_SCREENSHOT_BYTES} bytes` })
          }
          throw err
        }
      })

      v1.post('/builds/:id/finalize', { bodyLimit: JSON_BODY_LIMIT }, async (req, reply) => {
        const ctx = requireProject(req)
        const { id } = parse(idParams, req.params)
        const body = parse(finalizeBody, req.body)
        const build = await getProjectBuild(deps.db, ctx.project.id, id)
        if (!build) return reply.code(404).send({ error: 'Build not found' })

        // Direct-to-storage uploads: confirm the stored object's checksum before trusting it.
        if (deps.storage.kind === 's3') {
          await verifyStoredObjects(deps, [...new Set(body.screenshots.map((s) => s.sha256))])
        }

        const result = await finalizeBuild(deps.db, {
          buildId: build.id,
          ...(body.shardIndex ? { shardIndex: body.shardIndex } : {}),
          screenshots: body.screenshots,
        })
        if (result.status === 'missing') {
          return reply.code(409).send({
            error: `${result.missing.length} file(s) were not uploaded or failed verification`,
            missing: result.missing,
          })
        }
        const updated = (await getProjectBuild(deps.db, ctx.project.id, id)) ?? build
        return {
          build: describeBuild(ctx, updated, deps.publicOrigin),
          complete: result.complete,
          shardsReceived: result.shardsReceived,
          shardsTotal: result.shardsTotal,
        }
      })

      v1.get('/builds/:id/status', async (req, reply) => {
        const ctx = requireProject(req)
        const { id } = parse(idParams, req.params)
        const build = await getProjectBuild(deps.db, ctx.project.id, id)
        if (!build) return reply.code(404).send({ error: 'Build not found' })
        const outcome = buildOutcome({
          ...build,
          blockMergeOnChanges: ctx.project.blockMergeOnChanges,
        })
        return {
          build: describeBuild(ctx, build, deps.publicOrigin),
          counts: await getBuildCounts(deps.db, build.id),
          outcome,
          // M1 has no git host integrations, so the CI job itself is the merge gate (PLAN §7.4).
          gate: 'exit-code' as const,
          errorMessage: build.errorMessage,
        }
      })
    },
    { prefix: '/v1' },
  )
}

function describeBuild(
  ctx: ProjectContext,
  build: {
    id: string
    number: number
    name: string
    status: string
    conclusion: string | null
    reviewStatus: string
  },
  publicOrigin: string,
) {
  return {
    id: build.id,
    number: build.number,
    name: build.name,
    status: build.status,
    conclusion: build.conclusion,
    reviewStatus: build.reviewStatus,
    url: `${publicOrigin}/${ctx.orgSlug}/${ctx.project.slug}/builds/${build.number}`,
  }
}

async function authenticate(
  db: Database,
  req: FastifyRequest,
): Promise<ProjectContext | undefined> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined
  if (!token || !looksLikeProjectToken(token)) return undefined
  const project = await findProjectByTokenHash(db, hashToken(token))
  return project ? getProjectContext(db, project.id) : undefined
}

function requireProject(req: FastifyRequest): ProjectContext {
  if (!req.project) throw new Error('unauthenticated request reached a handler')
  return req.project
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    )
  }
  return result.data
}

/** S3 uploads go straight to storage; verify each pending object's stored checksum at finalize. */
async function verifyStoredObjects(deps: V1Deps, shas: string[]): Promise<void> {
  await Promise.all(
    shas.map(async (hash) => {
      const file = await getFile(deps.db, hash)
      if (!file || file.status === 'verified') return
      const info = await deps.storage.head(file.storageKey)
      if (info?.sha256 === hash) await markFileVerified(deps.db, hash, { size: info.size })
    }),
  )
}

function sendError(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message })
  if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message })
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message })
  // Fastify's own client errors (bad JSON, body too large, unsupported media type).
  if (err instanceof Error && 'statusCode' in err && typeof err.statusCode === 'number') {
    if (err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message })
    }
  }
  req.log.error({ err }, 'request failed')
  return reply.code(500).send({ error: 'Internal server error' })
}

class TooLargeError extends Error {}

function byteLimit(max: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length
      cb(seen > max ? new TooLargeError(`more than ${max} bytes`) : null, chunk)
    },
  })
}
