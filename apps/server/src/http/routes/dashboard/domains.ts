import {
  addWorkspaceDomain,
  getMemberRole,
  getWorkspaceBySlug,
  listWorkspaceDomains,
  NotFoundError,
  workspaceAcceptsSession,
  type WorkspaceDomain,
  removeWorkspaceDomain,
  type TxtResolver,
  verificationName,
  verificationValue,
  verifyWorkspaceDomain,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const workspaceParams = z.object({ workspace: z.string() })
const domainParams = workspaceParams.extend({ id: z.uuid() })
const addBody = z.object({ domain: z.string().max(253) })

function present(d: WorkspaceDomain) {
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
 * Email domains a workspace claims. Owners and admins manage the list; someone signing in
 * with an emailed code on a verified domain joins the workspace as a member.
 */
export const dashboardDomainRoutes: FastifyPluginAsync<
  Deps.Dashboard & { resolveTxt?: TxtResolver }
> = async (app, deps) => {
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
      await reply.code(403).send({ error: 'Only owners and admins can manage email domains' })
      return undefined
    }
    return workspace
  }

  app.get('/workspaces/:workspace/domains', async (req, reply) => {
    const workspace = await managed(req, reply)
    if (!workspace) return reply
    return { domains: (await listWorkspaceDomains(deps.db, workspace.id)).map(present) }
  })

  app.post('/workspaces/:workspace/domains', async (req, reply) => {
    const workspace = await managed(req, reply)
    if (!workspace) return reply
    const { domain } = parse(addBody, req.body)
    return reply
      .code(201)
      .send({ domain: present(await addWorkspaceDomain(deps.db, workspace.id, domain)) })
  })

  app.post('/workspaces/:workspace/domains/:id/verify', async (req, reply) => {
    const workspace = await managed(req, reply)
    if (!workspace) return reply
    const { id } = parse(domainParams, req.params)
    const verified = await verifyWorkspaceDomain(deps.db, workspace.id, id, deps.resolveTxt)
    return { verified }
  })

  app.delete('/workspaces/:workspace/domains/:id', async (req, reply) => {
    const workspace = await managed(req, reply)
    if (!workspace) return reply
    const { id } = parse(domainParams, req.params)
    await removeWorkspaceDomain(deps.db, workspace.id, id)
    return reply.code(204).send()
  })
}
