import {
  addWorkspaceDomain,
  listWorkspaceDomains,
  type WorkspaceDomain,
  removeWorkspaceDomain,
  type TxtResolver,
  verificationName,
  verificationValue,
  verifyWorkspaceDomain,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

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
  const managed = async (req: FastifyRequest) =>
    (
      await loadWorkspace(deps, req, {
        manage: true,
        forbidden: 'Only owners and admins can manage email domains',
      })
    ).workspace

  app.get('/workspaces/:workspace/domains', async (req) => {
    const workspace = await managed(req)
    return { domains: (await listWorkspaceDomains(deps.db, workspace.id)).map(present) }
  })

  app.post('/workspaces/:workspace/domains', async (req, reply) => {
    const workspace = await managed(req)
    const { domain } = parse(addBody, req.body)
    return reply
      .code(201)
      .send({ domain: present(await addWorkspaceDomain(deps.db, workspace.id, domain)) })
  })

  app.post('/workspaces/:workspace/domains/:id/verify', async (req) => {
    const workspace = await managed(req)
    const { id } = parse(domainParams, req.params)
    const verified = await verifyWorkspaceDomain(deps.db, workspace.id, id, deps.resolveTxt)
    return { verified }
  })

  app.delete('/workspaces/:workspace/domains/:id', async (req, reply) => {
    const workspace = await managed(req)
    const { id } = parse(domainParams, req.params)
    await removeWorkspaceDomain(deps.db, workspace.id, id)
    return reply.code(204).send()
  })
}
