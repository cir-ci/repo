import {
  getMemberRole,
  getOrganizationBySlug,
  NotFoundError,
  orgAcceptsSession,
  type Organization,
} from '@circi/db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'

import type { DashboardDeps } from './deps.ts'
import { parse } from './validation.ts'

const orgParams = z.object({ org: z.string() })

/**
 * The organization a dashboard request names, if the signed-in user is a member and it accepts
 * how they signed in; anyone else gets "not found", as for one that doesn't exist. Replies
 * itself when it returns undefined.
 */
export async function loadOrg(
  deps: Pick<DashboardDeps, 'db'>,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ org: Organization; user: ReturnType<typeof currentUser> } | undefined> {
  const { org: slug } = parse(orgParams, req.params)
  const user = currentUser(req)
  const org = await getOrganizationBySlug(deps.db, slug).catch((err: unknown) => {
    if (err instanceof NotFoundError) return undefined
    throw err
  })
  const ok =
    org !== undefined &&
    (await orgAcceptsSession(deps.db, org.id, user.method)) &&
    (await getMemberRole(deps.db, { userId: user.id, organizationId: org.id })) !== undefined
  if (!org || !ok) {
    await reply.code(404).send({ error: 'Organization not found' })
    return undefined
  }
  return { org, user }
}
