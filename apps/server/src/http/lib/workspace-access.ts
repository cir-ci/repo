import {
  getMemberRole,
  getWorkspaceBySlug,
  NotFoundError,
  workspaceAcceptsSession,
  type Workspace,
} from '@circi/db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'

import type { Deps } from './deps.ts'
import { parse } from './validation.ts'

const workspaceParams = z.object({ workspace: z.string() })

/**
 * The workspace a dashboard request names, if the signed-in user is a member and it accepts
 * how they signed in; anyone else gets "not found", as for one that doesn't exist. Replies
 * itself when it returns undefined.
 */
export async function loadWorkspace(
  deps: Pick<Deps.Dashboard, 'db'>,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ workspace: Workspace; user: ReturnType<typeof currentUser> } | undefined> {
  const { workspace: slug } = parse(workspaceParams, req.params)
  const user = currentUser(req)
  const workspace = await getWorkspaceBySlug(deps.db, slug).catch((err: unknown) => {
    if (err instanceof NotFoundError) return undefined
    throw err
  })
  const ok =
    workspace !== undefined &&
    (await workspaceAcceptsSession(deps.db, workspace.id, user.method)) &&
    (await getMemberRole(deps.db, { userId: user.id, workspaceId: workspace.id })) !== undefined
  if (!workspace || !ok) {
    await reply.code(404).send({ error: 'Workspace not found' })
    return undefined
  }
  return { workspace, user }
}
