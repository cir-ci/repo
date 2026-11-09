import { ForbiddenError, NotFoundError, ValidationError, canManage, verifyState } from '@circi/core'
import { getMemberRole } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'

import { INSTALL_FLOW } from '#composition/install-state.ts'
import { integrationContext } from '#composition/integration-context.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

import { createGeneric } from './context.ts'
import { callbackParams, callbackPath, callbackQuery, setupQuery } from './schemas.ts'

/**
 *   GET /integrations/:kind/callback   where the provider sends the browser back
 *   GET /integrations/:kind/setup      where the provider sends the browser after its app is installed
 */
export const dashboardIntegrationOauthRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const { registry, store } = createGeneric(deps)

  /**
   * Where the provider sends the browser back. The signed `state` must be one this instance issued
   * recently for this kind, to this very user, for a workspace they still manage; only then is
   * the code exchanged and the credentials stored (sealed). Installing again for the same account
   * replaces the credentials and clears "needs attention".
   */
  app.get('/integrations/:kind/callback', async (req, reply) => {
    const { kind } = parse(callbackParams, req.params)
    const query = parse(callbackQuery, req.query)
    const user = currentUser(req)
    const definition = registry.get(kind)
    const ctx = integrationContext(deps)
    const claims = ctx && query.state ? verifyState(ctx.authSecret, query.state) : undefined
    const workspaceId = claims?.workspaceId
    const workspaceSlug = claims?.workspaceSlug
    if (
      !definition?.oauth ||
      !ctx ||
      !claims ||
      !workspaceId ||
      !workspaceSlug ||
      claims.kind !== kind
    ) {
      throw new ValidationError('This install link is invalid or has expired; start again')
    }
    if (claims.userId !== user.id) {
      throw new ValidationError('This install link was started by someone else')
    }
    const role = await getMemberRole(deps.db, { userId: user.id, workspaceId: workspaceId })
    if (!canManage(role)) {
      throw new ForbiddenError('Only owners and admins can manage integrations')
    }
    const list = `/workspaces/${encodeURIComponent(workspaceSlug)}/settings/integrations`
    const failed = (result: 'denied' | 'failed') =>
      reply.redirect(`${list}?connect=${result}&kind=${encodeURIComponent(kind)}`)
    if (query.error || !query.code) return failed('denied')
    try {
      const connected = await definition.oauth.exchange(ctx, {
        code: query.code,
        redirectUri: `${deps.publicOrigin}/api${callbackPath(kind)}`,
      })
      const id = await store(workspaceId, user.id, definition, connected, ctx, { replace: true })
      return reply.redirect(`${list}/${encodeURIComponent(kind)}/${id}?connect=connected`)
    } catch (err) {
      req.log.warn({ err }, `could not finish the ${definition.name} install`)
      return failed('failed')
    }
  })

  /**
   * Where a provider sends the browser after its app is installed (`setup_url`; also when it is
   * installed from the provider's own site). With a `state` this instance issued (the install
   * started in a workspace's Add dialog) the installation is connected to that workspace by the
   * same `connect` and `store` as the manual form: the provider must really have the app
   * installed, an `exclusive` account may be used by no other workspace (409), and the signed-in
   * user must still own or administer the workspace. Without a `state` the person picks the
   * workspace on a dashboard page that connects through the same endpoint.
   */
  app.get('/integrations/:kind/setup', async (req, reply) => {
    const { kind } = parse(callbackParams, req.params)
    const query = parse(setupQuery, req.query)
    const user = currentUser(req)
    const definition = registry.get(kind)
    const ctx = integrationContext(deps)
    if (!definition?.connect || !definition.setup || !ctx) {
      throw new NotFoundError('Integration not found')
    }
    const claims = query.state ? verifyState(ctx.authSecret, query.state) : undefined
    if (query.state && (claims?.kind !== kind || claims.flow !== INSTALL_FLOW)) {
      throw new ValidationError('This install link is invalid or has expired; start again')
    }
    if (claims && claims.userId !== user.id) {
      throw new ValidationError('This install link was started by someone else')
    }
    const workspaceId = claims?.workspaceId
    const workspaceSlug = claims?.workspaceSlug
    const list = workspaceSlug
      ? `/workspaces/${encodeURIComponent(workspaceSlug)}/settings/integrations`
      : '/'
    const values = definition.setup(Object.fromEntries(Object.entries(query)))
    if (!values) {
      // A request to install, or an update that changed nothing: nothing to connect.
      return reply.redirect(
        workspaceSlug ? `${list}?connect=denied&kind=${encodeURIComponent(kind)}` : '/',
      )
    }
    if (!workspaceId || !workspaceSlug) {
      const rest = new URLSearchParams(Object.entries(query).filter(([k]) => k !== 'state'))
      return reply.redirect(`/integrations/${encodeURIComponent(kind)}/setup?${rest.toString()}`)
    }
    const role = await getMemberRole(deps.db, { userId: user.id, workspaceId: workspaceId })
    if (!canManage(role)) {
      throw new ForbiddenError('Only owners and admins can manage integrations')
    }
    if (definition.available && !definition.available(ctx)) {
      throw new ValidationError(`This instance has no ${definition.name} set up`)
    }
    const connected = await definition.connect(parse(definition.credentials, values), ctx)
    const id = await store(workspaceId, user.id, definition, connected, ctx, { replace: false })
    return reply.redirect(`${list}/${encodeURIComponent(kind)}/${id}?connect=connected`)
  })
}
