import {
  findSsoProviderWorkspaceId,
  fromNodeHeaders,
  listWorkspaceSsoProviders,
  withTrustedIssuer,
} from '@circi/auth'
import { ValidationError, webhookUrlProblem } from '@circi/core'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const workspaceParams = z.object({ workspace: z.string() })
const providerParams = workspaceParams.extend({ providerId: z.string() })
const registerBody = z.object({
  issuer: z.url().max(2048),
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(2048),
})

/**
 * A workspace's own OpenID Connect provider (PLAN §7.8). Owners and admins register it; the
 * people it signs in become members of this workspace only, and their sessions open nothing
 * else. Secrets are stored with the provider and never sent back.
 */
export const dashboardWorkspaceSsoRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const managed = async (req: FastifyRequest) =>
    (
      await loadWorkspace(deps, req, {
        manage: true,
        forbidden: 'Only owners and admins can manage single sign-on',
      })
    ).workspace

  const redirectUri = (providerId: string) =>
    `${deps.publicOrigin}/api/auth/sso/callback/${encodeURIComponent(providerId)}`

  app.get('/workspaces/:workspace/sso', async (req) => {
    const workspace = await managed(req)
    const rows = await listWorkspaceSsoProviders(deps.db, workspace.id)
    return {
      providers: rows.map((r) => ({
        providerId: r.providerId,
        issuer: r.issuer,
        redirectUri: redirectUri(r.providerId),
      })),
    }
  })

  app.post('/workspaces/:workspace/sso', async (req, reply) => {
    const workspace = await managed(req)
    const body = parse(registerBody, req.body)
    // The server will fetch from this address, so it gets the same scrutiny as a webhook's:
    // a public https address, unless the operator allows private ones.
    const allowPrivate = deps.webhookAllowPrivate === true
    const problem = webhookUrlProblem(body.issuer, { allowPrivate })
    if (problem) throw new ValidationError(`Issuer: ${problem}`)
    if (!allowPrivate && new URL(body.issuer).protocol !== 'https:') {
      throw new ValidationError('Issuer: use an https address')
    }
    const providerId = `${workspace.slug}-sso`
    await withTrustedIssuer(deps.auth, body.issuer, () =>
      deps.auth.api.registerSSOProvider({
        headers: fromNodeHeaders(req.headers),
        body: {
          providerId,
          issuer: body.issuer,
          // Routing by email domain isn't used: people start from the workspace's name.
          domain: new URL(body.issuer).hostname,
          organizationId: workspace.id,
          oidcConfig: {
            clientId: body.clientId,
            clientSecret: body.clientSecret,
            pkce: true,
            scopes: ['openid', 'email', 'profile'],
          },
        },
      }),
    )
    return reply
      .code(201)
      .send({ provider: { providerId, issuer: body.issuer, redirectUri: redirectUri(providerId) } })
  })

  app.delete('/workspaces/:workspace/sso/:providerId', async (req, reply) => {
    const workspace = await managed(req)
    const { providerId } = parse(providerParams, req.params)
    // Another workspace's provider is "not found", like everything of theirs.
    if ((await findSsoProviderWorkspaceId(deps.db, providerId)) !== workspace.id)
      return reply.code(404).send({ error: 'Provider not found' })
    await deps.auth.api.deleteSSOProvider({
      headers: fromNodeHeaders(req.headers),
      body: { providerId },
    })
    return reply.code(204).send()
  })
}
