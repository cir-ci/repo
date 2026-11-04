import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  type Database,
  findProjectBySlugs,
  getBuildDetail,
  getFile,
  listBuildsForProject,
  listProjectsOverview,
} from '@circi/db'
import type { StorageDriver } from '@circi/storage'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyRequest } from 'fastify'

export interface DashboardDeps {
  db: Database
  storage: StorageDriver
  /** Interim protection until accounts arrive in M2. Unset: the dashboard is off. */
  password?: string
  /** Built web app (apps/web/dist). Missing: the API still works, pages explain how to build. */
  webDist?: string
}

const SHA_RE = /^[0-9a-f]{64}$/

/**
 * Dashboard: JSON API under /api, screenshots by hash, and the web app. The CI API (/v1) and
 * health checks are registered elsewhere and never pass through this password check.
 */
export function registerDashboard(app: FastifyInstance, deps: DashboardDeps): void {
  void app.register(async (dash) => {
    dash.addHook('onRequest', async (req, reply) => {
      if (!deps.password) {
        return reply
          .code(503)
          .type(wantsHtml(req) ? 'text/html; charset=utf-8' : 'application/json')
          .send(
            wantsHtml(req)
              ? page(
                  'Dashboard is off',
                  'Set <code>DASHBOARD_PASSWORD</code> (12+ characters) to turn it on. It is a stand-in until CirCI has user accounts.',
                )
              : { error: 'The dashboard is off: set DASHBOARD_PASSWORD to turn it on' },
          )
      }
      if (!checkBasicAuth(req.headers.authorization, deps.password)) {
        return reply
          .code(401)
          .header('www-authenticate', 'Basic realm="CirCI", charset="UTF-8"')
          .send({ error: 'Sign in with the dashboard password' })
      }
      return undefined
    })

    dash.get('/api/projects', async () => ({ projects: await listProjectsOverview(deps.db) }))

    dash.get<{ Params: { org: string; project: string }; Querystring: { before?: string } }>(
      '/api/projects/:org/:project',
      async (req, reply) => {
        const project = await findProjectBySlugs(deps.db, req.params.org, req.params.project)
        if (!project) return reply.code(404).send({ error: 'Project not found' })
        const before = Number(req.query.before)
        const builds = await listBuildsForProject(deps.db, project.id, {
          limit: 50,
          ...(Number.isInteger(before) && before > 0 ? { beforeNumber: before } : {}),
        })
        return { project, builds }
      },
    )

    dash.get<{ Params: { org: string; project: string; number: string } }>(
      '/api/projects/:org/:project/builds/:number',
      async (req, reply) => {
        const project = await findProjectBySlugs(deps.db, req.params.org, req.params.project)
        const number = Number(req.params.number)
        if (!project || !Number.isInteger(number))
          return reply.code(404).send({ error: 'Build not found' })
        const detail = await getBuildDetail(deps.db, project.id, number)
        if (!detail) return reply.code(404).send({ error: 'Build not found' })
        return { project, ...detail }
      },
    )

    // Screenshots, diffs and thumbnails by content hash. The bytes behind a hash never change,
    // so browsers may cache them for good (unlike hosted sites, PLAN §7.6).
    dash.get<{ Params: { sha256: string } }>('/api/files/:sha256', async (req, reply) => {
      const hash = req.params.sha256
      if (!SHA_RE.test(hash)) return reply.code(404).send({ error: 'Not found' })
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

    const dist = deps.webDist
    if (dist && existsSync(join(dist, 'index.html'))) {
      await dash.register(fastifyStatic, {
        root: dist,
        wildcard: false,
        index: false,
        setHeaders(res, path) {
          // Vite puts content-hashed files under /assets; everything else must revalidate.
          res.header(
            'cache-control',
            path.includes(join(dist, 'assets'))
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          )
        },
      })
      // Client-side routes (/:org/:project/builds/:n …) all load the app shell.
      dash.get('/*', async (req, reply) => {
        if (isApiPath(req.url)) return reply.code(404).send({ error: 'Not found' })
        return reply.header('cache-control', 'no-cache').sendFile('index.html')
      })
    } else {
      dash.get('/*', async (req, reply) => {
        if (isApiPath(req.url)) return reply.code(404).send({ error: 'Not found' })
        return reply
          .type('text/html; charset=utf-8')
          .send(
            page(
              'Web app not built',
              'Run <code>pnpm build</code> to build <code>apps/web</code>. The API under <code>/api</code> works without it.',
            ),
          )
      })
    }
  })
}

function isApiPath(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/v1/')
}

function wantsHtml(req: FastifyRequest): boolean {
  return !isApiPath(req.url) && (req.headers.accept ?? '').includes('text/html')
}

/** Basic auth with any username; the password is compared in constant time via its digest. */
export function checkBasicAuth(header: string | undefined, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon < 0) return false
  const given = createHash('sha256')
    .update(decoded.slice(colon + 1))
    .digest()
  const expected = createHash('sha256').update(password).digest()
  return timingSafeEqual(given, expected)
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · CirCI</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#0f172a}code{background:#f1f5f9;padding:.1rem .3rem;border-radius:4px}@media(prefers-color-scheme:dark){body{background:#0b1120;color:#e2e8f0}code{background:#1e293b}}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`
}
