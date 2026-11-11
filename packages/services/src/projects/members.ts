import { type Database } from '@circi/db'
import {
  addProjectMembers,
  removeProjectMember,
  removeUserFromWorkspaceProjects,
} from '@circi/db/repositories'

import {
  type Actor,
  assertAllowed,
  canAddProjectMembers,
  canRemoveProjectMember,
} from '#src/access/index.ts'

const NOT_FOUND = 'Project not found'

/**
 * Adds people to a project (owners and admins only; themselves included). Everyone must belong to
 * the project's workspace, or nobody is added (`ValidationError`); someone already in the project is
 * left as they are. Returns the ids added now.
 */
export async function addMembersToProject(
  db: Database,
  input: { actor: Actor; projectId: string; userIds: string[] },
): Promise<string[]> {
  assertAllowed(canAddProjectMembers(input.actor), {
    notFound: NOT_FOUND,
    forbidden: 'Only owners and admins can add people to a project',
  })
  return db.transaction((tx) =>
    addProjectMembers(tx, {
      projectId: input.projectId,
      userIds: input.userIds,
      addedBy: input.actor.userId,
    }),
  )
}

/**
 * Takes a person out of a project: owners and admins remove anyone, a member removes only themselves
 * (leaves). In the same transaction they come off the project's review rules, its triage rotation
 * and the triage items assigned to them; past reviews, comments and review requests stay.
 * Removing someone who isn't in the project does nothing. Returns whether anyone was removed.
 */
export async function removeMemberFromProject(
  db: Database,
  input: { actor: Actor; projectId: string; userId: string },
): Promise<boolean> {
  assertAllowed(canRemoveProjectMember(input.actor, input.userId), {
    notFound: NOT_FOUND,
    forbidden: 'Only owners and admins can remove other people from a project',
  })
  return db.transaction((tx) =>
    removeProjectMember(tx, { projectId: input.projectId, userId: input.userId }),
  )
}

/** Takes a person out of every project of a workspace: they left it or were removed from it. */
export async function removeMemberFromWorkspaceProjects(
  db: Database,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  await db.transaction((tx) => removeUserFromWorkspaceProjects(tx, input))
}
