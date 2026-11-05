import { COMMIT_SHA_RE, isSha256, MAX_PARALLEL_SHARDS, ValidationError } from '@circi/core'
import {
  createBuild,
  findBaselineByCommits,
  getFile,
  getProjectBuild,
  hasUploadClaim,
  markFileVerified,
  planUploads,
  setParallelTotal,
} from '@circi/db'
import { finalizeBuild } from '@circi/services'
import { ChecksumMismatchError, contentKey } from '@circi/storage'
import multipart from '@fastify/multipart'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { V2Deps } from '../../deps.ts'
import { jsonErrorHandler } from '../../errors.ts'
import { requireProjectToken, currentProject } from '../../hooks/project-token.ts'
import { describeBuild } from '../../presenters.ts'
import { parse } from '../../validation.ts'
import { MAX_SCREENSHOT_BYTES } from '../v1/schemas.ts'

/**
 * The Argos upload protocol (`/v2`), so projects that already use the Argos SDKs (Playwright,
 * Cypress, Storybook…) can point them at CirCI by changing the API address and token. Shapes
 * follow `@argos-ci/core`'s `upload()`:
 *
 *   GET  /project          what the SDK needs to know about the project
 *   POST /baseline         the SDK found the commit history itself and asks which build it maps to
 *   POST /builds           create the build, learn which files to upload
 *   POST /uploads/…        the "presigned" upload target (multipart form with the file)
 *   PUT  /builds/:id       send screenshot names and metadata, in chunks; `final` ends a shard
 *
 * Not supported: Playwright traces, per-screenshot thresholds and `parentName` (accepted and
 * ignored), merge-queue fields, and parallel builds with `total: -1` (manual finalization).
 */

const JSON_LIMIT = 4 * 1024 * 1024

const baselineBody = z.object({
  commits: z.array(z.string()).max(2_000),
  name: z.string().optional(),
})

const createBody = z.object({
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

const updateBody = z.object({
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
function buildName(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
  return cleaned || undefined
}

export const argosRoutes: FastifyPluginAsync<V2Deps> = async (v2, deps) => {
  v2.setErrorHandler(jsonErrorHandler)

  // The upload target is called without the project token (as a presigned URL would be): the
  // file's hash is the credential, because the bytes are stored only if they match it.
  await v2.register(async (uploads) => {
    await uploads.register(multipart, { limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 } })
    uploads.post('/uploads/:buildId/:sha256', async (req, reply) => {
      const { buildId, sha256: hash } = parse(
        z.object({ buildId: z.uuid(), sha256: z.string() }),
        req.params,
      )
      const file = isSha256(hash) ? await getFile(deps.db, hash) : undefined
      if (!file || !(await hasUploadClaim(deps.db, buildId, hash))) {
        return reply.code(404).send({ error: 'This build did not ask for that file' })
      }
      if (file.status === 'verified') {
        await req.file().catch(() => undefined)
        return reply.code(204).send()
      }
      const part = await req.file()
      if (!part) return reply.code(400).send({ error: 'Send the file as a multipart form' })
      try {
        const result = await deps.storage.put(file.storageKey, part.file, {
          expectedSha256: hash,
          contentType: file.contentType ?? 'image/png',
        })
        if (part.file.truncated) {
          return reply
            .code(413)
            .send({ error: `Files are limited to ${MAX_SCREENSHOT_BYTES} bytes` })
        }
        await markFileVerified(deps.db, hash, { size: result.size })
        return reply.code(204).send()
      } catch (err) {
        if (err instanceof ChecksumMismatchError) {
          return reply
            .code(422)
            .send({ error: `The uploaded bytes hash to ${err.actual}, not ${hash}` })
        }
        throw err
      }
    })
  })

  await v2.register(async (api) => {
    api.addHook('onRequest', requireProjectToken(deps.auth, deps.db))

    api.get('/project', async (req) => {
      const { project } = currentProject(req)
      return {
        id: project.id,
        defaultBaseBranch: project.defaultBranch,
        // We can't read the repository ourselves, so SDKs must send their own history.
        hasRemoteContentAccess: false,
      }
    })

    api.post('/baseline', async (req) => {
      const { project } = currentProject(req)
      const body = parse(baselineBody, req.body)
      // The first entry is the commit itself; the baseline is searched among its ancestors.
      const commits = body.commits
        .slice(1)
        .filter((c) => COMMIT_SHA_RE.test(c))
        .map((c) => c.toLowerCase())
      const found = await findBaselineByCommits(deps.db, {
        projectId: project.id,
        name: buildName(body.name) ?? 'default',
        commits,
      })
      return {
        baseline: found
          ? {
              id: found.id,
              commit: found.commitSha,
              commitSha: found.commitSha,
              branch: found.branch,
            }
          : null,
      }
    })

    api.post('/builds', { bodyLimit: JSON_LIMIT }, async (req, reply) => {
      const ctx = currentProject(req)
      const body = parse(createBody, req.body)
      const keys = [...new Set(body.screenshots.map((s) => s.key))]
      const bad = keys.find((k) => !isSha256(k))
      if (bad) throw new ValidationError(`Screenshot key "${bad}" is not a sha256 hash`)
      const notPng = body.screenshots.find((s) => s.contentType && s.contentType !== 'image/png')
      if (notPng) {
        throw new ValidationError(
          `CirCI compares PNG screenshots; "${notPng.contentType}" is not supported`,
        )
      }

      const commit = body.commit.toLowerCase()
      const history = [body.referenceCommit, ...(body.parentCommits ?? [])]
        .filter((c): c is string => typeof c === 'string' && COMMIT_SHA_RE.test(c))
        .map((c) => c.toLowerCase())
        .filter((c) => c !== commit)
      const ancestorShas = [...new Set(history)]
      const name = buildName(body.name)
      const build = await createBuild(deps.db, {
        projectId: ctx.project.id,
        commitSha: commit,
        ...(name ? { name } : {}),
        branch: body.branch ?? null,
        prNumber: body.prNumber ?? null,
        baseBranch: body.referenceBranch ?? null,
        mergeBaseSha:
          body.referenceCommit && COMMIT_SHA_RE.test(body.referenceCommit)
            ? body.referenceCommit
            : null,
        ancestorShas,
        ancestryStatus: ancestorShas.length > 0 ? 'ok' : 'missing',
        historySource: 'sdk',
        // The total is only known when the last shard reports; start with the most it could be.
        ...(body.parallel && body.parallelNonce
          ? { parallel: { nonce: body.parallelNonce, total: MAX_PARALLEL_SHARDS } }
          : {}),
      })
      const planned = await planUploads(deps.db, {
        buildId: build.id,
        kind: 'screenshot',
        files: keys.map((sha256) => ({ sha256, size: 0, contentType: 'image/png' })),
        storageKeyFor: (s) => contentKey(s),
      })
      const target = (key: string) => ({
        key,
        postUrl: `${deps.publicOrigin}/v2/uploads/${build.id}/${key}`,
        fields: {},
      })
      const described = describeBuild(ctx, build, deps.publicOrigin)
      return reply.code(201).send({
        build: { id: build.id, url: described.url, number: build.number, status: build.status },
        screenshots: planned.map((p) => target(p.sha256)),
        pwTraces: [],
      })
    })

    api.put('/builds/:id', { bodyLimit: JSON_LIMIT }, async (req, reply) => {
      const ctx = currentProject(req)
      const { id } = parse(z.object({ id: z.uuid() }), req.params)
      const body = parse(updateBody, req.body)
      const build = await getProjectBuild(deps.db, ctx.project.id, id)
      if (!build) return reply.code(404).send({ error: 'Build not found' })

      if (body.parallelTotal !== undefined && body.parallelTotal !== null) {
        if (body.parallelTotal < 1) {
          throw new ValidationError(
            'Parallel builds that are finalized manually (parallelTotal -1) are not supported: pass the total number of shards',
          )
        }
        await setParallelTotal(deps.db, build.id, body.parallelTotal)
      }
      const result = await finalizeBuild(deps.db, {
        buildId: build.id,
        shardIndex: String(body.parallelIndex ?? 0),
        screenshots: body.screenshots.map((s) => ({
          name: s.name,
          sha256: s.key,
          ...(s.metadata ? { metadata: s.metadata } : {}),
        })),
        // Screenshots arrive in several requests; the shard is done with the `final` one.
        append: true,
        hold: body.final !== true,
      })
      if (result.status === 'missing') {
        return reply.code(400).send({
          error: `${result.missing.length} screenshot file(s) were not uploaded`,
          missing: result.missing,
        })
      }
      const updated = (await getProjectBuild(deps.db, ctx.project.id, id)) ?? build
      const described = describeBuild(ctx, updated, deps.publicOrigin)
      return {
        build: {
          id: updated.id,
          url: described.url,
          number: updated.number,
          status: updated.status,
        },
      }
    })
  })
}
