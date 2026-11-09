import { NotFoundError } from '@circi/core'
import {
  getMemberRole,
  getWorkspaceBySlug,
  workspaceAcceptsSession,
  type Workspace,
} from '@circi/db'
import {
  type Actor,
  assertAllowed,
  canDeleteWorkspace,
  canManageWorkspace,
  canReadWorkspace,
} from '@circi/services'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'

import type { Deps } from './deps.ts'
import { parse } from './validation.ts'

export const workspaceParams = z.object({ workspace: z.string() })

export namespace loadWorkspace {
  export interface Options {
    /** Owners and admins only: other members get 403 (non-members still get 404). */
    manage?: boolean
    /** Owners only, with `forbidden` as the 403 message. */
    owner?: boolean
    /** The 403 message for `manage` or `owner`. */
    forbidden?: string
  }
  export interface Found {
    workspace: Workspace
    user: ReturnType<typeof currentUser>
    /** The user's role in the workspace. */
    role: string
    /** Whether that role is owner or admin. */
    canManage: boolean
  }
}

/**
 * The workspace a dashboard request names, if the signed-in user is a member and it accepts
 * how they signed in; anyone else gets "not found" (thrown as `NotFoundError`, which the error
 * handler answers with 404), as for one that doesn't exist. With `manage` or `owner`, members
 * without the role get `ForbiddenError` (403).
 */
export async function loadWorkspace(
  deps: Pick<Deps.Dashboard, 'db'>,
  req: FastifyRequest,
  options: loadWorkspace.Options = {},
): Promise<loadWorkspace.Found> {
  const { workspace: slug } = parse(workspaceParams, req.params)
  const user = currentUser(req)
  const workspace = await getWorkspaceBySlug(deps.db, slug).catch((err: unknown) => {
    if (err instanceof NotFoundError) return undefined
    throw err
  })
  const visible =
    workspace !== undefined && (await workspaceAcceptsSession(deps.db, workspace.id, user.method))
  const role = visible
    ? await getMemberRole(deps.db, { userId: user.id, workspaceId: workspace.id })
    : undefined
  const actor: Actor = { userId: user.id, instanceAdmin: false, role }
  const messages = {
    notFound: 'Workspace not found',
    forbidden:
      options.forbidden ??
      (options.owner ? 'Only an owner can do this' : 'Only owners and admins can change this'),
  }
  assertAllowed(canReadWorkspace(actor), messages)
  if (options.owner) assertAllowed(canDeleteWorkspace(actor), messages)
  else if (options.manage) assertAllowed(canManageWorkspace(actor), messages)
  if (!workspace || role === undefined) throw new NotFoundError(messages.notFound)
  return { workspace, user, role, canManage: canManageWorkspace(actor).allow }
}
