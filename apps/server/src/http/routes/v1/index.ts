import type { FastifyPluginAsync } from 'fastify'

import type { V1Deps } from '../../deps.ts'
import { jsonErrorHandler } from '../../errors.ts'
import { requireProjectToken } from '../../hooks/project-token.ts'
import { buildRoutes } from './builds.ts'
import { fileRoutes } from './files.ts'
import { projectRoutes } from './project.ts'

/**
 * The CI API, registered under `/v1`. Everything in this scope needs a project token; the hook,
 * body parser and error handler set here apply to every route module registered below.
 */
export const v1Routes: FastifyPluginAsync<V1Deps> = async (v1, options) => {
  // Hand children only the dependencies: registration options also carry this scope's
  // `prefix`, which children would otherwise apply a second time (/v1/v1/…).
  const deps: V1Deps = {
    db: options.db,
    storage: options.storage,
    publicOrigin: options.publicOrigin,
  }
  v1.addHook('onRequest', requireProjectToken(deps.db))
  // Uploaded file bodies reach the handler as a raw stream.
  v1.addContentTypeParser(['image/png', 'application/octet-stream'], (_req, payload, done) => {
    done(null, payload)
  })
  v1.setErrorHandler(jsonErrorHandler)

  await v1.register(projectRoutes, deps)
  await v1.register(buildRoutes, deps)
  await v1.register(fileRoutes, deps)
}
