import { type Database } from '@circi/db'
import {
  commitLabelOfVersion,
  findExpiredSiteByLabel,
  findSiteByCustomDomain,
  findSiteByLabel,
  isVerifiedCustomDomain,
} from '@circi/db/queries'
import { confirmSiteSession, findSiteFile, openSiteSession } from '@circi/services'
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
import { PAGE_CSP, standalonePage } from '#http/lib/pages.ts'

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
 * label under the sites domain, or a verified custom domain, and lets everything else through to
 * the dashboard. The two never mix: a site address never reaches a dashboard route, and the
 * dashboard host never serves a file.
 *
 * A custom domain serves the project's default-branch version of its site and is its own address:
 * its sign-in token, site session and cookie are bound to the domain itself (a hostname label
 * never contains a dot, so the two kinds can't be confused). A verified domain whose default
 * branch has no upload yet is answered like an address that doesn't exist.
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

/** A host name worth a custom-domain lookup: dotted, ending in letters (so not an IP or `circi:3000`). */
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}$/

/** Self-contained (inline style and logo, no link to the dashboard): the sites domain stays separate. */
const NOT_FOUND_PAGE = standalonePage(
  'Site not found',
  'No site is published at this address. It may have expired, or the link is wrong.',
)

/** What an address that retention removed answers, to people who may open the site only. */
const EXPIRED_PAGE = standalonePage(
  'Site expired',
  'This site was removed once it was older than the retention period. Publish it again to bring it back.',
)

function page(reply: FastifyReply, status: number, html: string) {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', PAGE_CSP)
    .header('x-content-type-options', 'nosniff')
    .send(html)
}

function notFound(reply: FastifyReply) {
  // The page's one stylesheet is inline: its CSP allows exactly that (by hash) and nothing else.
  return page(reply, 404, NOT_FOUND_PAGE)
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
  const dashboardHost = new URL(deps.publicOrigin).hostname.toLowerCase()
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
    projectId: string | undefined,
  ): Promise<string | undefined> {
    const raw = parseCookies(req.headers.cookie).get(cookie)
    const id = raw ? readCookieValue(deps.secret, raw, label) : undefined
    if (!id || !workspaceId) return undefined
    const key = `${id}\0${label}`
    const last = confirmed.get(key)
    if (last !== undefined && Date.now() - last < (deps.revalidateMs ?? REVALIDATE_MS)) return id
    // Logging out, revoking the session, leaving the workspace or the project ends access here, within
    // a minute: this is where the cookie is checked against them again.
    if (
      !(await confirmSiteSession(deps.db, {
        id,
        label,
        workspaceId,
        ...(projectId ? { projectId } : {}),
      }))
    ) {
      confirmed.delete(key)
      return undefined
    }
    confirmed.set(key, Date.now())
    if (confirmed.size > 10_000) confirmed.clear()
    return id
  }

  return async (req, reply) => {
    const host = req.hostname.toLowerCase().replace(/:\d+$/, '')
    let label = labelOf(host, deps.sites.host)
    let custom = false
    if (label === undefined) {
      // The apex, deeper names and look-alikes serve nothing: the sites domain is for sites.
      if (host === deps.sites.host || host.endsWith(`.${deps.sites.host}`)) return notFound(reply)
      // Anything else is the dashboard, unless the host is a verified custom domain.
      if (host === dashboardHost || !DOMAIN_LIKE.test(host)) return undefined
      if (!(await isVerifiedCustomDomain(deps.db, host))) return undefined
      label = host
      custom = true
    }
    // Hosted sites are read-only.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(405).header('allow', 'GET, HEAD').send()
    }

    const cleanup = cleanupCookies(
      req.headers.cookie,
      cookie,
      custom ? host : deps.sites.host,
      secure,
    )
    if (cleanup.length > 0) void reply.header('set-cookie', cleanup)

    const url = new URL(req.url, 'http://x')
    const found = custom
      ? await findSiteByCustomDomain(deps.db, host)
      : parseLabel(label)
        ? await findSiteByLabel(deps.db, label)
        : undefined
    // An address retention removed: only told to people who may open the site, like any other.
    const expired =
      !found && !custom && parseLabel(label)
        ? await findExpiredSiteByLabel(deps.db, label)
        : undefined
    const owner = found ?? expired

    // The token handoff from the dashboard: spend it, start a site session, set the cookie.
    if (url.pathname === '/_circi/auth') {
      const token = url.searchParams.get('t')
      const id = await openSiteSession(deps.db, { token, label, siteExists: owner !== undefined })
      if (!id) return signIn(reply, label, safeReturn(url.searchParams.get('return')))
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

    const session = await hasAccess(req, label, owner?.workspace.id, owner?.project.id)
    if (!owner || !session) return signIn(reply, label, `${url.pathname}${url.search}`)
    if (!found) return page(reply, 410, EXPIRED_PAGE)

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
    const file = await findSiteFile(deps.db, {
      versionId: found.versionId,
      entryPath: found.entryPath,
      wanted,
      spa: found.site.spa,
    })
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
