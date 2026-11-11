import { ConflictError, type Database, NotFoundError } from '@circi/db'
import { findWorkspaceById, getMemberRole } from '@circi/db/queries'
import { getWorkspaceDeletedAt } from '@circi/db/repositories'

import { type Actor, assertAllowed, isInstanceAdmin } from '../access/index.ts'

/** The role an instance admin joins with. */
const JOIN_ROLE = 'admin'

/**
 * An instance admin who isn't in a workspace joins it as an admin, so they can open its
 * settings and projects. Checks who may (instance admins only), that the workspace exists and
 * isn't deleted, and that they aren't a member already (a ConflictError). `apply` writes the
 * membership through better-auth, which owns the member table. Nothing else follows: no job or
 * notice is queued.
 */
export async function joinWorkspace(db: Database, input: joinWorkspace.Input): Promise<void> {
  assertAllowed(isInstanceAdmin(input.actor), {
    notFound: 'No such workspace',
    forbidden: 'Only instance admins can do this',
  })
  const found = await findWorkspaceById(db, input.workspaceId)
  if (!found || (await getWorkspaceDeletedAt(db, input.workspaceId))) {
    throw new NotFoundError('No such workspace')
  }
  if ((await getMemberRole(db, input)) !== undefined) {
    throw new ConflictError("You're already a member of this workspace")
  }
  await input.apply(JOIN_ROLE)
}
export namespace joinWorkspace {
  export interface Input {
    actor: Pick<Actor, 'instanceAdmin'>
    workspaceId: string
    userId: string
    /** Adds the member with this role (through better-auth). */
    apply: (role: 'admin') => Promise<void>
  }
}
