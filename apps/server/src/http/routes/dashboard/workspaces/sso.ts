import {
  findSsoProviderWorkspaceId,
  fromNodeHeaders,
  listWorkspaceSsoProviders,
  withTrustedIssuer,
} from '@circi/auth'
import { ValidationError } from '@circi/core'
import { webhookUrlProblem } from '@circi/core/node'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const workspaceParams = z.object({ workspace: z.string() })
const providerParams = workspaceParams.extend({ providerId: z.string() })
/**
 * Registering fetches the issuer's discovery document. A host that doesn't answer (DNS, refused
 * connection, timeout) is the person's typo or firewall, not our fault: say so with a 400.
 */
function issuerFailure(err: unknown, issuer: string): unknown {
  // better-auth's own wording for a missing document is for developers; say what to check.
  const body = typeof err === 'object' && err !== null ? Reflect.get(err, 'body') : undefined
  const code = typeof body === 'object' && body !== null ? Reflect.get(body, 'code') : undefined
  if (code === 'discovery_not_found') {
    return new ValidationError(
      'That address has no OpenID Connect discovery document (/.well-known/openid-configuration).',
      { fields: { issuer: 'No OpenID Connect discovery document at this address' } },
    )
  }
  if (code === 'discovery_invalid_json') {
    return new ValidationError(
      "That address answered, but its OpenID Connect discovery document (/.well-known/openid-configuration) isn't valid.",
      { fields: { issuer: "The discovery document isn't valid" } },
    )
  }
  const status =
    typeof err === 'object' && err !== null ? Reflect.get(err, 'statusCode') : undefined
  const unreachable = typeof status === 'number' && status >= 500
  if (!unreachable || err instanceof ValidationError) return err
  return new ValidationError(`Couldn't reach that issuer: ${new URL(issuer).host} didn't answer.`)
}

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
    try {
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
    } catch (err) {
      throw issuerFailure(err, body.issuer)
    }
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
