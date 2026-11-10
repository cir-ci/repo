import { canManage, ForbiddenError, NotFoundError } from '@circi/core'

import type { Actor } from './actor.ts'

/**
 * The answer of a policy. A non-member is `not-member`, which callers present as "not found"
 * (so the existence of a workspace or team is not revealed); a member who lacks the role is
 * `not-manager`, `not-owner` or `not-instance-admin`, which callers present as "forbidden".
 * Order matters: membership is always decided before the role.
 */
export type Decision =
  | { allow: true }
  | {
      allow: false
      reason: 'not-member' | 'not-manager' | 'not-owner' | 'not-instance-admin' | 'not-author'
    }

const ALLOW: Decision = { allow: true }
const deny = (reason: Extract<Decision, { allow: false }>['reason']): Decision => ({
  allow: false,
  reason,
})

/** Members of the workspace may read it. */
export function canReadWorkspace(actor: Actor): Decision {
  return actor.role === undefined ? deny('not-member') : ALLOW
}

/**
 * A team is visible to its members and to the workspace's owners and admins. Other workspace
 * members get `not-member`, which callers present as "not found" like a team that doesn't exist.
 */
export function canSeeTeam(actor: Actor): Decision {
  const read = canReadWorkspace(actor)
  if (!read.allow) return read
  return canManage(actor.role) || actor.teamMember === true ? ALLOW : deny('not-member')
}

/** Whoever sees a team may read it (and its member list). */
export function canReadTeam(actor: Actor): Decision {
  return canSeeTeam(actor)
}

/** Owners and admins change a workspace's settings. */
export function canManageWorkspace(actor: Actor): Decision {
  const read = canReadWorkspace(actor)
  if (!read.allow) return read
  return canManage(actor.role) ? ALLOW : deny('not-manager')
}

/** Owners and admins change a team's settings, rules and integrations. */
export function canWriteTeam(actor: Actor): Decision {
  const see = canSeeTeam(actor)
  if (!see.allow) return see
  return canManageWorkspace(actor)
}

/** Owners and admins add people to any team, themselves included. */
export function canAddTeamMembers(actor: Actor): Decision {
  return canWriteTeam(actor)
}

/** Owners and admins remove anyone from a team; a member of it can remove only themselves (leave). */
export function canRemoveTeamMember(actor: Actor, targetUserId: string): Decision {
  const see = canSeeTeam(actor)
  if (!see.allow) return see
  if (canManage(actor.role)) return ALLOW
  return actor.userId === targetUserId ? ALLOW : deny('not-manager')
}

/** Only an owner deletes the workspace. */
export function canDeleteWorkspace(actor: Actor): Decision {
  const read = canReadWorkspace(actor)
  if (!read.allow) return read
  return actor.role === 'owner' ? ALLOW : deny('not-owner')
}

/** Whether the member is an owner of the workspace (what the settings page shows as `isOwner`). */
export function isWorkspaceOwner(actor: Pick<Actor, 'role'>): boolean {
  return actor.role === 'owner'
}

/** Only the author of a comment moves or resizes its region (owners and admins may delete, not reshape). */
export function canAdjustCommentRegion(
  actor: Pick<Actor, 'userId'>,
  authorId: string | null,
): Decision {
  return authorId !== null && authorId === actor.userId ? ALLOW : deny('not-author')
}

/** Instance admins run the whole instance. */
export function isInstanceAdmin(actor: Pick<Actor, 'instanceAdmin'>): Decision {
  return actor.instanceAdmin ? ALLOW : deny('not-instance-admin')
}

export namespace assertAllowed {
  export interface Messages {
    /** The message for a non-member, e.g. "Team not found". */
    notFound: string
    /** The message for a member without the role. */
    forbidden?: string
  }
}

/** Turns a denial into the domain error that says it: NotFoundError or ForbiddenError. */
export function assertAllowed(decision: Decision, messages: assertAllowed.Messages): void {
  if (decision.allow) return
  if (decision.reason === 'not-member') throw new NotFoundError(messages.notFound)
  throw new ForbiddenError(messages.forbidden ?? 'Forbidden')
}
