import { COMMIT_SHA_RE, isSha256, MAX_PARALLEL_SHARDS, ValidationError } from '@circi/core'
import {
  finalizeTeamBuild,
  findBaseline,
  findUpload,
  startBuildUpload,
  storeUpload,
} from '@circi/services'
import { ChecksumMismatchError, contentKey } from '@circi/storage'
import multipart from '@fastify/multipart'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { requireTeamToken, currentTeam } from '#http/hooks/team-token.ts'
import type { Deps } from '#http/lib/deps.ts'
import { jsonErrorHandler } from '#http/lib/errors.ts'
import { describeBuild } from '#http/lib/presenters.ts'
import { parse } from '#http/lib/validation.ts'
import { MAX_SCREENSHOT_BYTES } from '#http/routes/v1/schemas.ts'

import { baselineBody, buildName, createBody, JSON_LIMIT, updateBody } from './schemas.ts'

/**
 * The Argos upload protocol (`/v2`), so teams that already use the Argos SDKs (Playwright,
 * Cypress, Storybook…) can point them at CirCI by changing the API address and token. Shapes
 * follow `@argos-ci/core`'s `upload()`:
 *
 *   GET  /project          what the SDK needs to know about the team
 *   POST /baseline         the SDK found the commit history itself and asks which build it maps to
 *   POST /builds           create the build, learn which files to upload
 *   POST /uploads/…        the "presigned" upload target (multipart form with the file)
 *   PUT  /builds/:id       send screenshot names and metadata, in chunks; `final` ends a shard
 *
 * Not supported: Playwright traces, per-screenshot thresholds and `parentName` (accepted and
 * ignored), merge-queue fields, and parallel builds with `total: -1` (manual finalization).
 */

export const argosRoutes: FastifyPluginAsync<Deps.V2> = async (v2, deps) => {
  v2.setErrorHandler(jsonErrorHandler)

  // The upload target is called without the team token (as a presigned URL would be): the
  // file's hash is the credential, because the bytes are stored only if they match it.
  await v2.register(async (uploads) => {
    await uploads.register(multipart, { limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 } })
    uploads.post('/uploads/:buildId/:sha256', async (req, reply) => {
      const { buildId, sha256: hash } = parse(
        z.object({ buildId: z.uuid(), sha256: z.string() }),
        req.params,
      )
      const file = isSha256(hash)
        ? await findUpload(deps.db, { sha256: hash, buildId })
        : ({ state: 'unknown' } as const)
      if (file.state === 'unknown') {
        return reply.code(404).send({ error: 'This build did not ask for that file' })
      }
      if (file.state === 'verified') {
        await req.file().catch(() => undefined)
        return reply.code(204).send()
      }
      const part = await req.file()
      if (!part) return reply.code(400).send({ error: 'Send the file as a multipart form' })
      try {
        const stored = await storeUpload(deps.db, deps.storage, {
          sha256: hash,
          storageKey: file.storageKey,
          contentType: file.contentType,
          content: part.file,
          accept: () => !part.file.truncated,
        })
        if (stored.status === 'rejected') {
          return reply
            .code(413)
            .send({ error: `Files are limited to ${MAX_SCREENSHOT_BYTES} bytes` })
        }
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
    api.addHook('onRequest', requireTeamToken(deps.auth, deps.db))

    api.get('/project', async (req) => {
      const { team } = currentTeam(req)
      return {
        id: team.id,
        defaultBaseBranch: team.defaultBranch,
        // We can't read the repository ourselves, so SDKs must send their own history.
        hasRemoteContentAccess: false,
      }
    })

    api.post('/baseline', async (req) => {
      const { team } = currentTeam(req)
      const body = parse(baselineBody, req.body)
      const found = await findBaseline(deps.db, {
        teamId: team.id,
        name: buildName(body.name) ?? 'default',
        commits: body.commits,
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
      const ctx = currentTeam(req)
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
      const { build, planned } = await startBuildUpload(deps.db, {
        build: {
          teamId: ctx.team.id,
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
          ...(body.author ? { author: { login: body.author } } : {}),
          // The total is only known when the last shard reports; start with the most it could be.
          ...(body.parallel && body.parallelNonce
            ? { parallel: { nonce: body.parallelNonce, total: MAX_PARALLEL_SHARDS } }
            : {}),
        },
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
      const ctx = currentTeam(req)
      const { id } = parse(z.object({ id: z.uuid() }), req.params)
      const body = parse(updateBody, req.body)
      const result = await finalizeTeamBuild(deps.db, {
        teamId: ctx.team.id,
        buildId: id,
        ...(body.parallelTotal !== undefined && body.parallelTotal !== null
          ? { parallelTotal: body.parallelTotal }
          : {}),
        shard: {
          shardIndex: String(body.parallelIndex ?? 0),
          screenshots: body.screenshots.map((s) => ({
            name: s.name,
            sha256: s.key,
            ...(s.metadata ? { metadata: s.metadata } : {}),
          })),
          // Screenshots arrive in several requests; the shard is done with the `final` one.
          append: true,
          hold: body.final !== true,
        },
      })
      if (result.status === 'not-found') return reply.code(404).send({ error: 'Build not found' })
      if (result.status === 'missing') {
        return reply.code(400).send({
          error: `${result.missing.length} screenshot file(s) were not uploaded`,
          missing: result.missing,
        })
      }
      const updated = result.build
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
