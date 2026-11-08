import { createSiteToken, findSiteByLabel, getMemberRole, orgAcceptsSession } from '@circi/db'
import { parseLabel } from '@circi/sites'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '../../hooks/session.ts'
import type { DashboardDeps } from '../../lib/deps.ts'
import { parse } from '../../lib/validation.ts'

const body = z.object({
  label: z.string().max(80),
  returnPath: z.string().max(2048).default('/'),
})

/**
 * Step two of opening a hosted site (PLAN §7.6): the person is signed in to the dashboard, and
 * asks for access to one address. If they belong to the site's organization (and their sign-in
 * method is accepted there) they get a one-minute, single-use token for that address. Everyone
 * else, and every address that doesn't exist, gets the same "not found".
 */
export const dashboardSiteHandoffRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.post('/site-handoff', async (req, reply) => {
    const sites = deps.sites
    if (!sites) return reply.code(404).send({ error: 'Not found' })
    const { label, returnPath } = parse(body, req.body)
    const user = currentUser(req)
    const found = parseLabel(label) ? await findSiteByLabel(deps.db, label) : undefined
    const allowed =
      found !== undefined &&
      (await getMemberRole(deps.db, { userId: user.id, organizationId: found.org.id })) !==
        undefined &&
      (await orgAcceptsSession(deps.db, found.org.id, user.method))
    if (!found || !allowed) return reply.code(404).send({ error: 'Not found' })

    const token = await createSiteToken(deps.db, {
      label,
      userId: user.id,
      authSessionId: user.sessionId,
    })
    const url = new URL('/_circi/auth', sites.originFor(label))
    url.searchParams.set('t', token)
    url.searchParams.set(
      'return',
      returnPath.startsWith('/') && !returnPath.startsWith('//') ? returnPath : '/',
    )
    return { url: url.toString() }
  })
}
