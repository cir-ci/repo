import type { Integration } from '@circi/api'
import { ValidationError } from '@circi/core'
import { signState } from '@circi/core/node'
import type { FastifyPluginAsync } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

import { createGeneric } from './context.ts'
import { callbackPath, kindParams } from './schemas.ts'

/**
 *   POST   /workspaces/:workspace/integrations/:kind/connect       connect with the definition's form
 *   GET    /workspaces/:workspace/integrations/:kind/install       the provider's OAuth install address
 */
export const dashboardIntegrationConnectRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const { loadForManager, definitionFor, contextFor, store } = createGeneric(deps)

  /**
   * Connects an integration with the values of its connect form. The definition's `connect`
   * checks them against the provider before anything is stored; the credentials are sealed. An
   * account the workspace already connected is a 409.
   */
  app.post('/workspaces/:workspace/integrations/:kind/connect', async (req, reply) => {
    const found = await loadForManager(req)
    const { kind } = parse(kindParams, req.params)
    const definition = definitionFor(kind)
    const ctx = contextFor()
    if (!definition.connect) {
      throw new ValidationError(`${definition.name} is connected by installing its app`)
    }
    if (definition.available && !definition.available(ctx)) {
      throw new ValidationError(`This instance has no ${definition.name} set up`)
    }
    const input = parse(definition.credentials, req.body ?? {})
    // An IntegrationError it throws is answered by the error handler (400, 409, 502…).
    const connected = await definition.connect(input, ctx)
    const id = await store(found.workspace.id, found.user.id, definition, connected, ctx, {
      replace: false,
    })
    return reply.code(201).send({ id })
  })

  /** The address to send the browser to for installing the app; `state` binds workspace, user and kind. */
  app.get('/workspaces/:workspace/integrations/:kind/install', async (req) => {
    const found = await loadForManager(req)
    const { kind } = parse(kindParams, req.params)
    const definition = definitionFor(kind)
    const ctx = contextFor()
    if (!definition.oauth) {
      throw new ValidationError(`${definition.name} has no install to start`)
    }
    if (!definition.oauth.available(ctx)) {
      throw new ValidationError(`This instance has no ${definition.name} app configured`)
    }
    const state = signState(ctx.authSecret, {
      kind,
      workspaceId: found.workspace.id,
      workspaceSlug: found.workspace.slug,
      userId: found.user.id,
    })
    const payload: Integration.Install = {
      url: definition.oauth.authorizeUrl(ctx, {
        redirectUri: `${deps.publicOrigin}/api${callbackPath(kind)}`,
        state,
      }),
    }
    return payload
  })
}
