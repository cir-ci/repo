import { Readable } from 'node:stream'

import { INSTANCE_LIMIT_BOUNDS } from '@circi/core'
import { servedCommitForBranch } from '@circi/db/queries'
import { publishSiteFiles } from '@circi/services'
import { IngestError, ingestTarball, SITE_KIND_IDS } from '@circi/sites'
import { contentKey } from '@circi/storage'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentProject } from '#http/hooks/project-token.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const uploadQuery = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'use letters, digits, ".", "_" or "-"')
    .default('site'),
  kind: z.enum(['auto', ...SITE_KIND_IDS]).default('auto'),
  commit: z.string().regex(/^[0-9a-fA-F]{12,64}$/, 'send the full commit SHA'),
  branch: z.string().max(255).optional(),
  /** What `git ls-remote` says the branch points at. */
  branch_tip: z.string().optional(),
  /** The CLI checked locally that this commit descends from the one the branch address serves. */
  descends: bool.optional(),
  /** The upload comes from a fork's pull request: never moves a branch address. */
  fork: bool.optional(),
  spa: bool.optional(),
})

/**
 * `POST /v1/sites`: uploads a site as a `.tar.gz` (PLAN §7.6). The archive is read with strict
 * limits and only regular files; each file is hashed and stored once by content. The response
 * lists the site's addresses on the sites domain.
 */
export const siteRoutes: FastifyPluginAsync<Deps.V1> = async (app, deps) => {
  app.post(
    '/sites',
    {
      // The archive is compressed and the limit is on what it unpacks to, which `ingestTarball` enforces; this one only
      // bounds the upload. With a setting that can change, the largest value it may have.
      bodyLimit:
        (deps.sites?.maxBytesNow
          ? INSTANCE_LIMIT_BOUNDS.staticSitesMaxMb.max * 1024 * 1024
          : (deps.sites?.maxBytes ?? 0)) +
        1024 * 1024,
    },
    async (req, reply) => {
      const ctx = currentProject(req)
      const sites = deps.sites
      if (!sites)
        return reply.code(404).send({ error: "Static site hosting isn't set up on this server" })
      if (!ctx.project.staticHostingEnabled) {
        return reply.code(403).send({
          error: 'Static site hosting is off for this project: turn it on in the project settings',
        })
      }
      const q = parse(uploadQuery, req.query)
      const body = req.body
      if (!(body instanceof Readable)) {
        return reply.code(415).send({ error: 'Send the site as application/gzip (a .tar.gz)' })
      }

      // `contentKey` makes a fresh key each call: one per blob, remembered for the database row.
      const keys = new Map<string, string>()
      let files: ingestTarball.File[]
      try {
        files = await ingestTarball(body, {
          maxBytes: (await sites.maxBytesNow?.()) ?? sites.maxBytes,
          store: async (file, content) => {
            // Identical files (same hash) are stored once.
            if (keys.has(file.sha256)) return
            const key = contentKey(file.sha256)
            keys.set(file.sha256, key)
            await deps.storage.put(key, Readable.from([content]), {
              expectedSha256: file.sha256,
              contentType: file.contentType,
            })
          },
        })
      } catch (err) {
        if (err instanceof IngestError) {
          return reply
            .code(err.code === 'too-large' || err.code === 'bomb' ? 413 : 400)
            .send({ error: err.message })
        }
        throw err
      }
      const published = await publishSiteFiles(deps.db, {
        project: { id: ctx.project.id, slug: ctx.project.slug, workspaceSlug: ctx.workspaceSlug },
        name: q.name,
        kind: q.kind,
        spa: q.spa,
        commitSha: q.commit,
        branch: q.branch,
        branchTip: q.branch_tip,
        descends: q.descends,
        fork: q.fork,
        files,
        storageKeys: keys,
      })
      return reply.code(201).send({
        site: published.site,
        version: published.version,
        addresses: {
          commit: sites.originFor(published.commitLabel),
          ...(published.branchLabel ? { branch: sites.originFor(published.branchLabel) } : {}),
        },
        branchMoved: published.branchLabel !== undefined,
        replaced: published.replaced,
      })
    },
  )

  /** Which commit a branch address serves now, for a CLI deciding whether it may move it. */
  app.get('/sites/served', async (req) => {
    const ctx = currentProject(req)
    const q = parse(z.object({ name: z.string().default('site'), branch: z.string() }), req.query)
    return {
      commit: (await servedCommitForBranch(deps.db, ctx.project.id, q.name, q.branch)) ?? null,
    }
  })
}
