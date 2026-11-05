import { fromNodeHeaders, withTrustedIssuer } from '@circi/auth'
import { ValidationError, webhookUrlProblem } from '@circi/core'
import {
  getMemberRole,
  getOrganizationBySlug,
  NotFoundError,
  orgAcceptsSession,
  schema,
} from '@circi/db'
import { eq } from 'drizzle-orm'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../deps.ts'
import { currentUser } from '../../hooks/session.ts'
import { parse } from '../../validation.ts'

const orgParams = z.object({ org: z.string() })
const providerParams = orgParams.extend({ providerId: z.string() })
const registerBody = z.object({
  issuer: z.url().max(2048),
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(2048),
})

/**
 * An organization's own OpenID Connect provider (PLAN §7.8). Owners and admins register it; the
 * people it signs in become members of this organization only, and their sessions open nothing
 * else. Secrets are stored with the provider and never sent back.
 */
export const dashboardOrgSsoRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  async function managed(req: FastifyRequest, reply: FastifyReply) {
    const { org: slug } = parse(orgParams, req.params)
    const user = currentUser(req)
    const org = await getOrganizationBySlug(deps.db, slug).catch((err: unknown) => {
      if (err instanceof NotFoundError) return undefined
      throw err
    })
    const role = org
      ? await getMemberRole(deps.db, { userId: user.id, organizationId: org.id })
      : undefined
    if (!org || !role || !(await orgAcceptsSession(deps.db, org.id, user.method))) {
      await reply.code(404).send({ error: 'Organization not found' })
      return undefined
    }
    if (role !== 'owner' && role !== 'admin') {
      await reply.code(403).send({ error: 'Only owners and admins can manage single sign-on' })
      return undefined
    }
    return org
  }

  const redirectUri = (providerId: string) =>
    `${deps.publicOrigin}/api/auth/sso/callback/${encodeURIComponent(providerId)}`

  app.get('/organizations/:org/sso', async (req, reply) => {
    const org = await managed(req, reply)
    if (!org) return reply
    const rows = await deps.db
      .select({ providerId: schema.ssoProvider.providerId, issuer: schema.ssoProvider.issuer })
      .from(schema.ssoProvider)
      .where(eq(schema.ssoProvider.organizationId, org.id))
    return {
      providers: rows.map((r) => ({
        providerId: r.providerId,
        issuer: r.issuer,
        redirectUri: redirectUri(r.providerId),
      })),
    }
  })

  app.post('/organizations/:org/sso', async (req, reply) => {
    const org = await managed(req, reply)
    if (!org) return reply
    const body = parse(registerBody, req.body)
    // The server will fetch from this address, so it gets the same scrutiny as a webhook's:
    // a public https address, unless the operator allows private ones.
    const allowPrivate = deps.webhookAllowPrivate === true
    const problem = webhookUrlProblem(body.issuer, { allowPrivate })
    if (problem) throw new ValidationError(`Issuer: ${problem}`)
    if (!allowPrivate && new URL(body.issuer).protocol !== 'https:') {
      throw new ValidationError('Issuer: use an https address')
    }
    const providerId = `${org.slug}-sso`
    await withTrustedIssuer(deps.auth, body.issuer, () =>
      deps.auth.api.registerSSOProvider({
        headers: fromNodeHeaders(req.headers),
        body: {
          providerId,
          issuer: body.issuer,
          // Routing by email domain isn't used: people start from the organization's name.
          domain: new URL(body.issuer).hostname,
          organizationId: org.id,
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

  app.delete('/organizations/:org/sso/:providerId', async (req, reply) => {
    const org = await managed(req, reply)
    if (!org) return reply
    const { providerId } = parse(providerParams, req.params)
    const [row] = await deps.db
      .select({ organizationId: schema.ssoProvider.organizationId })
      .from(schema.ssoProvider)
      .where(eq(schema.ssoProvider.providerId, providerId))
    // Another organization's provider is "not found", like everything of theirs.
    if (row?.organizationId !== org.id) return reply.code(404).send({ error: 'Provider not found' })
    await deps.auth.api.deleteSSOProvider({
      headers: fromNodeHeaders(req.headers),
      body: { providerId },
    })
    return reply.code(204).send()
  })
}
