import { type Database } from '@circi/db'
import {
  findExpiredSiteByLabel,
  findSiteByAddress,
  getMemberRole,
  isProjectMember,
  workspaceAcceptsSession,
} from '@circi/db/queries'
import { createSiteToken, type SessionMethod } from '@circi/db/repositories'

import { canSeeProject } from '#src/access/index.ts'

/**
 * Step two of opening a hosted site (PLAN §7.6): a signed-in person asks for access to one
 * address. A member of the site's workspace, whose sign-in method the workspace accepts, gets a
 * one-minute, single-use token for that address. Everyone else, and every address that doesn't
 * exist, gets `undefined`: the caller answers all of them the same way ("not found").
 */
export async function handOffToSite(
  db: Database,
  input: handOffToSite.Input,
): Promise<string | undefined> {
  const { label, userId, sessionId, method } = input
  // Only addresses that exist match (a hostname label, or a verified custom domain): a
  // malformed one simply finds nothing.
  // An address that expired still hands members a token, so the site's host can tell them so.
  const found = (await findSiteByAddress(db, label)) ?? (await findExpiredSiteByLabel(db, label))
  if (!found) return undefined
  const workspaceId = found.workspace.id
  const role = await getMemberRole(db, { userId, workspaceId })
  if (role === undefined) return undefined
  // A site belongs to a project, which only its members and the workspace's owners and admins see.
  const projectMember = await isProjectMember(db, found.project.id, userId)
  if (!canSeeProject({ userId, instanceAdmin: false, role, projectMember }).allow) return undefined
  if (!(await workspaceAcceptsSession(db, workspaceId, method))) return undefined
  return db.transaction((tx) => createSiteToken(tx, { label, userId, authSessionId: sessionId }))
}

export namespace handOffToSite {
  export interface Input {
    /** The address the person wants to open: a site label, or a custom domain. */
    label: string
    userId: string
    /** The dashboard session the token is tied to. */
    sessionId: string
    /** How that session signed in; the workspace may refuse some methods. */
    method: SessionMethod | undefined
  }
}
