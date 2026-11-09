import { type Database } from '@circi/db'
import { findSiteByAddress, getMemberRole, workspaceAcceptsSession } from '@circi/db/queries'
import { createSiteToken, type SessionMethod } from '@circi/db/repositories'

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
  const found = await findSiteByAddress(db, label)
  if (!found) return undefined
  const workspaceId = found.workspace.id
  if ((await getMemberRole(db, { userId, workspaceId })) === undefined) return undefined
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
