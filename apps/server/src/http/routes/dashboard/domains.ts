import {
  addOrgDomain,
  getMemberRole,
  getOrganizationBySlug,
  listOrgDomains,
  NotFoundError,
  orgAcceptsSession,
  type OrgDomain,
  removeOrgDomain,
  type TxtResolver,
  verificationName,
  verificationValue,
  verifyOrgDomain,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { DashboardDeps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const orgParams = z.object({ org: z.string() })
const domainParams = orgParams.extend({ id: z.uuid() })
const addBody = z.object({ domain: z.string().max(253) })

function present(d: OrgDomain) {
  return {
    id: d.id,
    domain: d.domain,
    verified: d.verifiedAt !== null,
    // What to put in DNS until it's verified.
    ...(d.verifiedAt
      ? {}
      : { dnsName: verificationName(d.domain), dnsValue: verificationValue(d) }),
  }
}

/**
 * Email domains an organization claims. Owners and admins manage the list; someone signing in
 * with an emailed code on a verified domain joins the organization as a member.
 */
export const dashboardDomainRoutes: FastifyPluginAsync<
  DashboardDeps & { resolveTxt?: TxtResolver }
> = async (app, deps) => {
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
      await reply.code(403).send({ error: 'Only owners and admins can manage email domains' })
      return undefined
    }
    return org
  }

  app.get('/organizations/:org/domains', async (req, reply) => {
    const org = await managed(req, reply)
    if (!org) return reply
    return { domains: (await listOrgDomains(deps.db, org.id)).map(present) }
  })

  app.post('/organizations/:org/domains', async (req, reply) => {
    const org = await managed(req, reply)
    if (!org) return reply
    const { domain } = parse(addBody, req.body)
    return reply.code(201).send({ domain: present(await addOrgDomain(deps.db, org.id, domain)) })
  })

  app.post('/organizations/:org/domains/:id/verify', async (req, reply) => {
    const org = await managed(req, reply)
    if (!org) return reply
    const { id } = parse(domainParams, req.params)
    const verified = await verifyOrgDomain(deps.db, org.id, id, deps.resolveTxt)
    return { verified }
  })

  app.delete('/organizations/:org/domains/:id', async (req, reply) => {
    const org = await managed(req, reply)
    if (!org) return reply
    const { id } = parse(domainParams, req.params)
    await removeOrgDomain(deps.db, org.id, id)
    return reply.code(204).send()
  })
}
