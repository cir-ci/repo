import { type Database } from '@circi/db'
import {
  addTeamMembers,
  removeTeamMember,
  removeUserFromWorkspaceTeams,
} from '@circi/db/repositories'

import {
  type Actor,
  assertAllowed,
  canAddTeamMembers,
  canRemoveTeamMember,
} from '#src/access/index.ts'

const NOT_FOUND = 'Team not found'

/**
 * Adds people to a team (owners and admins only; themselves included). Everyone must belong to
 * the team's workspace, or nobody is added (`ValidationError`); someone already in the team is
 * left as they are. Returns the ids added now.
 */
export async function addMembersToTeam(
  db: Database,
  input: { actor: Actor; teamId: string; userIds: string[] },
): Promise<string[]> {
  assertAllowed(canAddTeamMembers(input.actor), {
    notFound: NOT_FOUND,
    forbidden: 'Only owners and admins can add people to a team',
  })
  return db.transaction((tx) =>
    addTeamMembers(tx, {
      teamId: input.teamId,
      userIds: input.userIds,
      addedBy: input.actor.userId,
    }),
  )
}

/**
 * Takes a person out of a team: owners and admins remove anyone, a member removes only themselves
 * (leaves). In the same transaction they come off the team's review rules, its triage rotation
 * and the triage items assigned to them; past reviews, comments and review requests stay.
 * Removing someone who isn't in the team does nothing. Returns whether anyone was removed.
 */
export async function removeMemberFromTeam(
  db: Database,
  input: { actor: Actor; teamId: string; userId: string },
): Promise<boolean> {
  assertAllowed(canRemoveTeamMember(input.actor, input.userId), {
    notFound: NOT_FOUND,
    forbidden: 'Only owners and admins can remove other people from a team',
  })
  return db.transaction((tx) =>
    removeTeamMember(tx, { teamId: input.teamId, userId: input.userId }),
  )
}

/** Takes a person out of every team of a workspace: they left it or were removed from it. */
export async function removeMemberFromWorkspaceTeams(
  db: Database,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  await db.transaction((tx) => removeUserFromWorkspaceTeams(tx, input))
}
