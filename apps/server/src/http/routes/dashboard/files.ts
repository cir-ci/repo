import { canUserAccessFile, getFile } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'

import type { DashboardDeps } from '../../deps.ts'
import { currentUser } from '../../hooks/session.ts'

const SHA_RE = /^[0-9a-f]{64}$/

/**
 * `GET /api/files/:sha256`: screenshots, diffs and thumbnails by content hash. The bytes behind a
 * hash never change, so browsers may cache them for good (unlike hosted sites, PLAN §7.6).
 * Files are shared across organizations by hash, so each request checks the file belongs to a
 * build in one of the signed-in user's organizations.
 */
export const dashboardFileRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get<{ Params: { sha256: string } }>('/files/:sha256', async (req, reply) => {
    const hash = req.params.sha256
    if (!SHA_RE.test(hash)) return reply.code(404).send({ error: 'Not found' })
    // Checked before the 304 shortcut: a cached copy must not outlive losing access.
    if (!(await canUserAccessFile(deps.db, currentUser(req).id, hash, currentUser(req).method))) {
      return reply.code(404).send({ error: 'Not found' })
    }
    if (req.headers['if-none-match'] === `"${hash}"`) return reply.code(304).send()
    const file = await getFile(deps.db, hash)
    if (!file || file.status !== 'verified') return reply.code(404).send({ error: 'Not found' })
    const stream = await deps.storage.get(file.storageKey)
    return reply
      .header('content-type', file.contentType ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('etag', `"${hash}"`)
      .header('x-content-type-options', 'nosniff')
      .send(stream)
  })
}
