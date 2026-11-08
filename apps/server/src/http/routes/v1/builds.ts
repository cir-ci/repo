import { buildOutcome } from '@circi/core'
import {
  getBuildCounts,
  getFile,
  getTeamBuild,
  getTeamLink,
  markFileVerified,
  planUploads,
} from '@circi/db'
import { finalizeBuild, gateInputs, gitKinds, startBuild } from '@circi/services'
import { contentKey } from '@circi/storage'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentTeam } from '#http/hooks/team-token.ts'
import type { Deps } from '#http/lib/deps.ts'
import { describeBuild } from '#http/lib/presenters.ts'
import { parse } from '#http/lib/validation.ts'

import { buildIdParams, createBuildBody, finalizeBody, JSON_BODY_LIMIT } from './schemas.ts'

const statusQuery = z.object({ gate: z.enum(['status', 'exit-code']).optional() })

/**
 * A build's life from CI (PLAN §7.1): create it and learn what to upload, finalize each shard,
 * then poll its status.
 */
export const buildRoutes: FastifyPluginAsync<Deps.V1> = async (app, deps) => {
  app.post('/builds', { bodyLimit: JSON_BODY_LIMIT }, async (req, reply) => {
    const ctx = currentTeam(req)
    const body = parse(createBuildBody, req.body)
    const build = await startBuild(deps.db, {
      teamId: ctx.team.id,
      commitSha: body.commitSha,
      ...(body.name ? { name: body.name } : {}),
      branch: body.branch ?? null,
      prNumber: body.prNumber ?? null,
      baseBranch: body.baseBranch ?? null,
      mergeBaseSha: body.mergeBaseSha ?? null,
      ...(body.ancestorShas ? { ancestorShas: body.ancestorShas } : {}),
      ...(body.ancestryStatus ? { ancestryStatus: body.ancestryStatus } : {}),
      ...(body.parallel ? { parallel: body.parallel } : {}),
      ...(body.author ? { author: body.author } : {}),
    })
    const planned = await planUploads(deps.db, {
      buildId: build.id,
      kind: 'screenshot',
      files: body.files,
      storageKeyFor: (s) => contentKey(s),
    })
    const uploads = await Promise.all(planned.map((p) => uploadInstruction(deps, p)))
    return reply.code(201).send({ build: describeBuild(ctx, build, deps.publicOrigin), uploads })
  })

  app.post('/builds/:id/finalize', { bodyLimit: JSON_BODY_LIMIT }, async (req, reply) => {
    const ctx = currentTeam(req)
    const { id } = parse(buildIdParams, req.params)
    const body = parse(finalizeBody, req.body)
    const build = await getTeamBuild(deps.db, ctx.team.id, id)
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
    const updated = (await getTeamBuild(deps.db, ctx.team.id, id)) ?? build
    return {
      build: describeBuild(ctx, updated, deps.publicOrigin),
      complete: result.complete,
      shardsReceived: result.shardsReceived,
      shardsTotal: result.shardsTotal,
    }
  })

  app.get('/builds/:id/status', async (req, reply) => {
    const ctx = currentTeam(req)
    const { id } = parse(buildIdParams, req.params)
    const { gate: requested } = parse(statusQuery, req.query)
    const build = await getTeamBuild(deps.db, ctx.team.id, id)
    if (!build) return reply.code(404).send({ error: 'Build not found' })
    // Who blocks the merge (PLAN §7.4): the check on the git host when this team reports to
    // one, otherwise this CI job. The CLI's `--gate` overrides the choice.
    const linked =
      (deps.githubApp === true || deps.githubAppNow?.() === true) &&
      (await getTeamLink(deps.db, ctx.team.id, gitKinds()))
    const gate = requested ?? (linked ? 'status' : 'exit-code')
    return {
      build: describeBuild(ctx, build, deps.publicOrigin),
      counts: await getBuildCounts(deps.db, build.id),
      outcome: buildOutcome({ ...build, ...(await gateInputs(deps.db, build)) }),
      gate,
      errorMessage: build.errorMessage,
    }
  })
}

/**
 * How the CLI should send one file: a checksum-bound presigned URL with S3, or a PUT through
 * this API (with the team token) for local-disk storage.
 */
async function uploadInstruction(
  deps: Deps.V1,
  p: { sha256: string; storageKey: string; size: number; contentType: string },
) {
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
    auth: 'token' as const,
  }
}

/** S3 uploads go straight to storage; verify each pending object's stored checksum at finalize. */
async function verifyStoredObjects(deps: Deps.V1, shas: string[]): Promise<void> {
  await Promise.all(
    shas.map(async (hash) => {
      const file = await getFile(deps.db, hash)
      if (!file || file.status === 'verified') return
      const info = await deps.storage.head(file.storageKey)
      if (info?.sha256 === hash) await markFileVerified(deps.db, hash, { size: info.size })
    }),
  )
}
