import { isSha256 } from '@circi/core'
import { FILE_URL_WINDOW_SECONDS, verifyFileSignature } from '@circi/core/node'
import { canUserAccessFile, getFile } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'

import { requireSession } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'

/** Where a verified file lives; hashes are content addresses, so this barely ever changes. */
interface Located {
  storageKey: string
  contentType: string | null
}

/** How long the location of a file is remembered: retention or a storage move shows up within it. */
const LOCATION_TTL_MS = 60_000
const LOCATION_MAX_ENTRIES = 5_000

/**
 * Only the images CirCI itself made are served here. Hosted-site assets live in the same table
 * (`kind: 'asset'`, any content type, including HTML a member published) and must never be
 * served from the dashboard's origin.
 */
const SERVED_KINDS: ReadonlySet<string> = new Set(['screenshot', 'diff', 'thumbnail'])
const SERVED_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/webp'])

/**
 * `GET /api/files/:sha256`: screenshots, diffs and thumbnails by content hash. The bytes behind a
 * hash never change, but access can end, so a cached copy lives no longer than the link's window.
 *
 * Files are shared across workspaces by hash, so a request must show it may read this one:
 *
 * - **A signed link** (`?exp&sig`, minted by `hooks/file-signatures.ts` for the hashes a reply
 *   carried, which that reply's route had authorized) is checked by signature alone: no session
 *   and no access query, and a conditional request is answered before anything is read. The
 *   file's location is read once and remembered for a minute.
 * - Only `screenshot`, `diff` and `thumbnail` files of PNG or WebP are served; anything else is a 404.
 * - **Otherwise the session** decides, with the access query on every request (a cached copy
 *   must not outlive losing access, so it runs before the 304 shortcut). A link whose signature
 *   is missing, wrong or expired takes this path too, so a long-open page doesn't break while its
 *   session is good. It is also what links outside the dashboard (an issue's image) use.
 */
export const dashboardFileRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const sessionHook = requireSession(deps.auth, deps.db)
  const locations = new Map<string, Located & { until: number }>()

  async function locate(hash: string): Promise<Located | undefined> {
    const known = locations.get(hash)
    if (known && known.until > Date.now()) return known
    locations.delete(hash)
    const file = await getFile(deps.db, hash)
    if (!file || file.status !== 'verified') return undefined
    if (!SERVED_KINDS.has(file.kind) || !SERVED_TYPES.has(file.contentType ?? '')) return undefined
    if (locations.size >= LOCATION_MAX_ENTRIES) locations.clear()
    const located = { storageKey: file.storageKey, contentType: file.contentType }
    locations.set(hash, { ...located, until: Date.now() + LOCATION_TTL_MS })
    return located
  }

  app.get<{ Params: { sha256: string }; Querystring: { exp?: string; sig?: string } }>(
    '/files/:sha256',
    async (req, reply) => {
      const hash = req.params.sha256
      if (!isSha256(hash)) return reply.code(404).send({ error: 'Not found' })
      const { exp, sig } = req.query
      const signed =
        deps.authSecret !== undefined &&
        typeof exp === 'string' &&
        typeof sig === 'string' &&
        verifyFileSignature(deps.authSecret, { sha256: hash, exp, sig })
      if (!signed) {
        // Same answers as the rest of the dashboard API: 401 without a session.
        const refused = await sessionHook.call(app, req, reply)
        if (refused) return refused
        const user = req.user
        if (!user) return reply.code(401).send({ error: 'Sign in to continue' })
        // Checked before the 304 shortcut: a cached copy must not outlive losing access.
        if (!(await canUserAccessFile(deps.db, user.id, hash, user.method))) {
          return reply.code(404).send({ error: 'Not found' })
        }
      }
      if (req.headers['if-none-match'] === `"${hash}"`) return reply.code(304).send()
      const file = await locate(hash)
      if (!file) return reply.code(404).send({ error: 'Not found' })
      const stream = await deps.storage.get(file.storageKey)
      // Cached no longer than a link stays valid (a signed link's own expiry, a window for a session).
      const maxAge = signed
        ? Math.max(0, Number(exp) - Math.floor(Date.now() / 1000))
        : FILE_URL_WINDOW_SECONDS
      return reply
        .header('content-type', file.contentType)
        .header('cache-control', `private, max-age=${maxAge}`)
        .header('etag', `"${hash}"`)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "sandbox; default-src 'none'")
        .send(stream)
    },
  )
}
