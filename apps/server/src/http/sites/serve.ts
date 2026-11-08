import {
  type Database,
  commitLabelOfVersion,
  consumeSiteToken,
  createSiteSession,
  findSiteByLabel,
  getSiteFile,
  siteSessionValid,
  touchSiteSession,
} from '@circi/db'
import {
  labelOf,
  parseLabel,
  KINDS,
  isSiteKindId,
  requestPath,
  RESERVED_PREFIX,
} from '@circi/sites'
import type { StorageDriver } from '@circi/storage'
import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'

import {
  cleanupCookies,
  cookieName,
  makeCookieValue,
  parseCookies,
  readCookieValue,
  setCookie,
} from './cookie.ts'

/**
 * Serving hosted sites (PLAN §7.6): a hook that answers every request whose Host is exactly one
 * label under the sites domain, and lets everything else through to the dashboard. The two never
 * mix: a site address never reaches a dashboard route, and the dashboard host never serves a file.
 *
 * Every request needs the site's own cookie. Without one (or with a stale one) the visitor is
 * sent to the dashboard to sign in, *whatever the address*: live, expired or never used get the
 * same answer, so nobody can probe which addresses exist.
 */

export namespace siteHostHook {
  export interface Options {
    db: Database
    storage: StorageDriver
    /** Dashboard origin, where sign-in happens and which may frame sites. */
    publicOrigin: string
    sites: Deps.Sites
    /** Signs site cookies. */
    secret: string
    /** How long a cookie is trusted before it's checked against the dashboard session again. */
    revalidateMs?: number
  }
}

const REVALIDATE_MS = 60_000

const NOT_FOUND_PAGE = `<!doctype html><meta charset="utf-8"><title>Not found</title>
<body style="font:16px system-ui;margin:4rem auto;max-width:28rem;text-align:center"><h1>Not found</h1></body>`

function notFound(reply: FastifyReply) {
  return reply.code(404).header('content-type', 'text/html; charset=utf-8').send(NOT_FOUND_PAGE)
}

/** Only same-site paths: never `//host`, never a backslash, never a scheme. */
function safeReturn(raw: unknown): string {
  return typeof raw === 'string' &&
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    !raw.includes('\\')
    ? raw
    : '/'
}

export function siteHostHook(deps: siteHostHook.Options): onRequestAsyncHookHandler {
  const secure = deps.publicOrigin.startsWith('https:')
  const cookie = cookieName(secure)
  /** `session id + label` → when it was last confirmed against the dashboard session. */
  const confirmed = new Map<string, number>()

  const signIn = (reply: FastifyReply, label: string, returnTo: string) => {
    const url = new URL('/_sso/site', deps.publicOrigin)
    url.searchParams.set('host', label)
    url.searchParams.set('return', returnTo)
    return reply
      .code(302)
      .header('cache-control', 'no-store')
      .header('location', url.toString())
      .send()
  }

  async function hasAccess(
    req: FastifyRequest,
    label: string,
    workspaceId: string | undefined,
  ): Promise<string | undefined> {
    const raw = parseCookies(req.headers.cookie).get(cookie)
    const id = raw ? readCookieValue(deps.secret, raw, label) : undefined
    if (!id || !workspaceId) return undefined
    const key = `${id}\0${label}`
    const last = confirmed.get(key)
    if (last !== undefined && Date.now() - last < (deps.revalidateMs ?? REVALIDATE_MS)) return id
    // Logging out, revoking the session or leaving the workspace ends access here, within
    // a minute: this is where the cookie is checked against them again.
    if (!(await siteSessionValid(deps.db, { id, label, workspaceId }))) {
      confirmed.delete(key)
      return undefined
    }
    confirmed.set(key, Date.now())
    if (confirmed.size > 10_000) confirmed.clear()
    await touchSiteSession(deps.db, id)
    return id
  }

  return async (req, reply) => {
    const label = labelOf(req.hostname, deps.sites.host)
    if (label === undefined) {
      // The apex, deeper names and look-alikes serve nothing: the sites domain is for sites.
      const host = req.hostname.toLowerCase()
      if (host === deps.sites.host || host.endsWith(`.${deps.sites.host}`)) return notFound(reply)
      return undefined
    }
    // Hosted sites are read-only.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(405).header('allow', 'GET, HEAD').send()
    }

    const cleanup = cleanupCookies(req.headers.cookie, cookie, deps.sites.host, secure)
    if (cleanup.length > 0) void reply.header('set-cookie', cleanup)

    const url = new URL(req.url, 'http://x')
    const found = parseLabel(label) ? await findSiteByLabel(deps.db, label) : undefined

    // The token handoff from the dashboard: spend it, start a site session, set the cookie.
    if (url.pathname === '/_circi/auth') {
      const token = url.searchParams.get('t')
      const spent = token && found ? await consumeSiteToken(deps.db, token, label) : undefined
      if (!spent) return signIn(reply, label, safeReturn(url.searchParams.get('return')))
      const id = await createSiteSession(deps.db, { label, ...spent })
      return reply
        .code(302)
        .header('cache-control', 'no-store')
        .header('set-cookie', [
          ...cleanup,
          setCookie(cookie, makeCookieValue(deps.secret, id, label), secure),
        ])
        .header('location', safeReturn(url.searchParams.get('return')))
        .send()
    }

    const session = await hasAccess(req, label, found?.workspace.id)
    if (!found || !session) return signIn(reply, label, `${url.pathname}${url.search}`)

    // Everything under /_circi/ is CirCI's, never the upload's.
    if (`${url.pathname.slice(1)}/`.startsWith(RESERVED_PREFIX)) return notFound(reply)

    const kind = isSiteKindId(found.site.kind) ? KINDS[found.site.kind] : KINDS.generic

    // Service workers: only for kinds that need one, and only on a commit address, because a
    // branch address serves many versions over time and an old worker would keep controlling
    // the next. A 404 also makes the browser drop a worker it already had.
    if (
      req.headers['service-worker'] === 'script' &&
      !(kind.serviceWorker && found.linkKind === 'commit')
    ) {
      return notFound(reply)
    }
    if (kind.serviceWorker && found.linkKind === 'branch') {
      const commit = await commitLabelOfVersion(deps.db, found.versionId)
      if (commit) {
        return reply
          .code(302)
          .header('cache-control', 'no-store')
          .header('location', `${deps.sites.originFor(commit)}${req.url}`)
          .send()
      }
    }

    const wanted = requestPath(url.pathname)
    if (wanted === undefined) return notFound(reply)
    const candidates = [
      wanted === '' ? found.entryPath : wanted,
      ...(wanted === '' ? [] : [`${wanted}/index.html`]),
    ]
    let file
    for (const path of candidates) {
      // eslint-disable-next-line no-await-in-loop -- at most two lookups
      file = await getSiteFile(deps.db, found.versionId, path)
      if (file) break
    }
    if (!file && found.site.spa && !/\.[A-Za-z0-9]{1,8}$/.test(wanted)) {
      file = await getSiteFile(deps.db, found.versionId, found.entryPath)
    }
    if (!file) return notFound(reply)

    // Same caching for every kind: never stored by shared caches (every response needs login),
    // always revalidated (a branch address moves, a CI re-run replaces a commit's files), and
    // cheap when nothing changed: the file's own hash is the ETag.
    const etag = `"${file.sha256}"`
    void reply
      .header('cache-control', 'private, no-cache')
      .header('etag', etag)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', `frame-ancestors 'self' ${deps.publicOrigin}`)
      .header('cross-origin-opener-policy', 'same-origin')
      .header('cross-origin-resource-policy', 'same-origin')
    if (req.headers['if-none-match'] === etag) return reply.code(304).send()
    void reply.header('content-type', file.contentType).header('content-length', file.size)
    if (req.method === 'HEAD') {
      // Fastify answers `content-length: 0` to a HEAD it sends nothing for; write the head
      // ourselves so it reports the size a GET would send.
      void reply.hijack()
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value)
      }
      reply.raw.writeHead(200)
      reply.raw.end()
      return reply
    }
    return reply.send(await deps.storage.get(file.storageKey))
  }
}
