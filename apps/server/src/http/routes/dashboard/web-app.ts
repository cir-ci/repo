import { existsSync } from 'node:fs'
import { join } from 'node:path'

import fastifyStatic from '@fastify/static'
import type { FastifyPluginAsync } from 'fastify'

import type { DashboardDeps } from '../../deps.ts'
import { isApiPath, noticePage } from '../../pages.ts'

/**
 * The built web app (apps/web/dist): static files, and the app shell for every client-side
 * route. Unknown `/api` and `/v1` paths get JSON 404s instead of the shell.
 */
export const webAppRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  const dist = deps.webDist
  if (!dist || !existsSync(join(dist, 'index.html'))) {
    app.get('/*', async (req, reply) => {
      if (isApiPath(req.url)) return reply.code(404).send({ error: 'Not found' })
      return reply
        .type('text/html; charset=utf-8')
        .send(
          noticePage(
            'Web app not built',
            'Run <code>pnpm build</code> to build <code>apps/web</code>. The API under <code>/api</code> works without it.',
          ),
        )
    })
    return
  }

  await app.register(fastifyStatic, {
    root: dist,
    wildcard: false,
    index: false,
    setHeaders(res, path) {
      // Vite puts content-hashed files under /assets; everything else must revalidate.
      res.header(
        'cache-control',
        path.includes(join(dist, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache',
      )
    },
  })
  app.get('/*', async (req, reply) => {
    if (isApiPath(req.url)) return reply.code(404).send({ error: 'Not found' })
    return reply.header('cache-control', 'no-cache').sendFile('index.html')
  })
}
