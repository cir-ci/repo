import type { FastifyPluginAsync } from 'fastify'

import { requireTeamToken } from '#http/hooks/team-token.ts'
import type { Deps } from '#http/lib/deps.ts'
import { jsonErrorHandler } from '#http/lib/errors.ts'

import { buildRoutes } from './builds.ts'
import { fileRoutes } from './files.ts'
import { siteRoutes } from './sites.ts'
import { teamRoutes } from './team.ts'

/**
 * The CI API, registered under `/v1`. Everything in this scope needs a team token; the hook,
 * body parser and error handler set here apply to every route module registered below.
 */
export const v1Routes: FastifyPluginAsync<Deps.V1> = async (v1, deps) => {
  v1.addHook('onRequest', requireTeamToken(deps.auth, deps.db))
  // Uploaded file bodies reach the handler as a raw stream.
  v1.addContentTypeParser(
    ['image/png', 'application/octet-stream', 'application/gzip', 'application/x-gzip'],
    (_req, payload, done) => {
      done(null, payload)
    },
  )
  v1.setErrorHandler(jsonErrorHandler)

  await v1.register(teamRoutes, deps)
  await v1.register(buildRoutes, deps)
  await v1.register(fileRoutes, deps)
  await v1.register(siteRoutes, deps)
}
