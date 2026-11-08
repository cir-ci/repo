import { fromNodeHeaders, withTrustedIssuer } from '@circi/auth'
import { ValidationError, webhookUrlProblem } from '@circi/core'
import {
  getMemberRole,
  getWorkspaceBySlug,
  NotFoundError,
  workspaceAcceptsSession,
  schema,
} from '@circi/db'
import { eq } from 'drizzle-orm'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

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
  async function managed(req: FastifyRequest, reply: FastifyReply) {
    const { workspace: slug } = parse(workspaceParams, req.params)
    const user = currentUser(req)
    const workspace = await getWorkspaceBySlug(deps.db, slug).catch((err: unknown) => {
      if (err instanceof NotFoundError) return undefined
      throw err
    })
    const role = workspace
      ? await getMemberRole(deps.db, { userId: user.id, workspaceId: workspace.id })
      : undefined
    if (
      !workspace ||
      !role ||
      !(await workspaceAcceptsSession(deps.db, workspace.id, user.method))
    ) {
      await reply.code(404).send({ error: 'Workspace not found' })
      return undefined
    }
    if (role !== 'owner' && role !== 'admin') {
      await reply.code(403).send({ error: 'Only owners and admins can manage single sign-on' })
      return undefined
    }
    return workspace
  }

  const redirectUri = (providerId: string) =>
    `${deps.publicOrigin}/api/auth/sso/callback/${encodeURIComponent(providerId)}`

  app.get('/workspaces/:workspace/sso', async (req, reply) => {
    const workspace = await managed(req, reply)
    if (!workspace) return reply
    const rows = await deps.db
      .select({ providerId: schema.ssoProvider.providerId, issuer: schema.ssoProvider.issuer })
      .from(schema.ssoProvider)
      .where(eq(schema.ssoProvider.workspaceId, workspace.id))
    return {
      providers: rows.map((r) => ({
        providerId: r.providerId,
        issuer: r.issuer,
        redirectUri: redirectUri(r.providerId),
      })),
    }
  })

  app.post('/workspaces/:workspace/sso', async (req, reply) => {
    const workspace = await managed(req, reply)
    if (!workspace) return reply
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
    const workspace = await managed(req, reply)
    if (!workspace) return reply
    const { providerId } = parse(providerParams, req.params)
    const [row] = await deps.db
      .select({ workspaceId: schema.ssoProvider.workspaceId })
      .from(schema.ssoProvider)
      .where(eq(schema.ssoProvider.providerId, providerId))
    // Another workspace's provider is "not found", like everything of theirs.
    if (row?.workspaceId !== workspace.id)
      return reply.code(404).send({ error: 'Provider not found' })
    await deps.auth.api.deleteSSOProvider({
      headers: fromNodeHeaders(req.headers),
      body: { providerId },
    })
    return reply.code(204).send()
  })
}
