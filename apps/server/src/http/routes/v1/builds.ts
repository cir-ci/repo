import { finalizeProjectBuild, getBuildStatus, startBuildUpload } from '@circi/services'
import { contentKey } from '@circi/storage'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentProject } from '#http/hooks/project-token.ts'
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
    const ctx = currentProject(req)
    const body = parse(createBuildBody, req.body)
    const { build, planned } = await startBuildUpload(deps.db, {
      build: {
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
        ...(body.author ? { author: body.author } : {}),
      },
      files: body.files,
      storageKeyFor: (s) => contentKey(s),
    })
    const uploads = await Promise.all(planned.map((p) => uploadInstruction(deps, p)))
    return reply.code(201).send({ build: describeBuild(ctx, build, deps.publicOrigin), uploads })
  })

  app.post('/builds/:id/finalize', { bodyLimit: JSON_BODY_LIMIT }, async (req, reply) => {
    const ctx = currentProject(req)
    const { id } = parse(buildIdParams, req.params)
    const body = parse(finalizeBody, req.body)
    const result = await finalizeProjectBuild(deps.db, {
      projectId: ctx.project.id,
      buildId: id,
      shard: {
        ...(body.shardIndex ? { shardIndex: body.shardIndex } : {}),
        screenshots: body.screenshots,
      },
      // Direct-to-storage uploads: the service confirms each stored object's checksum first.
      ...(deps.storage.kind === 's3' ? { verifyIn: deps.storage } : {}),
    })
    if (result.status === 'not-found') return reply.code(404).send({ error: 'Build not found' })
    if (result.status === 'missing') {
      return reply.code(409).send({
        error: `${result.missing.length} file(s) weren't uploaded or failed verification`,
        missing: result.missing,
      })
    }
    return {
      build: describeBuild(ctx, result.build, deps.publicOrigin),
      complete: result.complete,
      shardsReceived: result.shardsReceived,
      shardsTotal: result.shardsTotal,
    }
  })

  app.get('/builds/:id/status', async (req, reply) => {
    const ctx = currentProject(req)
    const { id } = parse(buildIdParams, req.params)
    const { gate: requested } = parse(statusQuery, req.query)
    const status = await getBuildStatus(deps.db, {
      projectId: ctx.project.id,
      buildId: id,
      gate: requested,
      gitHostReports: deps.githubApp === true || deps.githubAppNow?.() === true,
    })
    if (!status) return reply.code(404).send({ error: 'Build not found' })
    return {
      build: describeBuild(ctx, status.build, deps.publicOrigin),
      counts: status.counts,
      unreadable: status.unreadable,
      outcome: status.outcome,
      gate: status.gate,
      errorMessage: status.build.errorMessage,
    }
  })
}

/**
 * How the CLI should send one file: a checksum-bound presigned URL with S3, or a PUT through
 * this API (with the project token) for local-disk storage.
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
