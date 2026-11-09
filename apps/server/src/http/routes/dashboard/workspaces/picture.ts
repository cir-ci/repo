import type { Workspace } from '@circi/api'
import { updateWorkspace } from '@circi/auth'
import {
  ValidationError,
  WORKSPACE_PICTURE_MAX_BYTES,
  WORKSPACE_PICTURE_TYPES,
  workspacePictureUrl,
} from '@circi/core'
import { getWorkspacePicture } from '@circi/db/queries'
import { storeWorkspacePicture } from '@circi/services'
import type { FastifyError, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { jsonErrorHandler } from '#http/lib/errors.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const versionQuery = z.object({ v: z.string().optional() })
const MANAGE = 'Only owners and admins can change the workspace picture'
const REFUSED = 'Send a PNG, JPEG or WebP image of at most 1 MB'

/**
 * A workspace's picture: `GET` serves it to members, `PUT` (the image as the request body) and
 * `DELETE` are for owners and admins. The image is resized to a 256 px square and stored like any
 * other file; the workspace's `logo` (better-auth's column, written through its API) names it.
 * The old picture is left for storage GC, which collects files nothing names any more.
 */
export const dashboardWorkspacePictureRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  // The image arrives as the raw body. Any other type is a clear 400, not Fastify's 415.
  app.addContentTypeParser(
    [...WORKSPACE_PICTURE_TYPES],
    { parseAs: 'buffer', bodyLimit: WORKSPACE_PICTURE_MAX_BYTES },
    (_req, body, done) => {
      done(null, body)
    },
  )
  app.addContentTypeParser('*', (_req, _payload, done) => {
    done(new ValidationError(REFUSED))
  })
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if ('code' in err && err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(400).send({ error: 'The picture is larger than 1 MB' })
    }
    return jsonErrorHandler(err, req, reply)
  })

  app.get('/workspaces/:workspace/picture', async (req, reply) => {
    const found = await loadWorkspace(deps, req)
    const picture = await getWorkspacePicture(deps.db, found.workspace.id)
    if (!picture) return reply.code(404).send({ error: 'This workspace has no picture' })
    const etag = `"${picture.sha256}"`
    // The address carries the hash (`?v=`), so a request that names the live one may cache for good.
    const versioned = parse(versionQuery, req.query).v === picture.sha256.slice(0, 12)
    reply
      .header('etag', etag)
      .header(
        'cache-control',
        versioned ? 'private, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate',
      )
      .header('x-content-type-options', 'nosniff')
    if (req.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply
      .header('content-type', picture.contentType)
      .send(await deps.storage.get(picture.storageKey))
  })

  app.put('/workspaces/:workspace/picture', async (req): Promise<Workspace.Picture> => {
    const found = await loadWorkspace(deps, req, { manage: true, forbidden: MANAGE })
    if (!Buffer.isBuffer(req.body)) throw new ValidationError(REFUSED)
    const stored = await storeWorkspacePicture(deps.db, deps.storage, { bytes: req.body })
    await updateWorkspace(deps.auth, deps.db, {
      workspaceId: found.workspace.id,
      logo: stored.logo,
    })
    return { picture: workspacePictureUrl(found.workspace.slug, stored.logo) }
  })

  app.delete('/workspaces/:workspace/picture', async (req): Promise<Workspace.Picture> => {
    const found = await loadWorkspace(deps, req, { manage: true, forbidden: MANAGE })
    await updateWorkspace(deps.auth, deps.db, { workspaceId: found.workspace.id, logo: null })
    return { picture: null }
  })
}
