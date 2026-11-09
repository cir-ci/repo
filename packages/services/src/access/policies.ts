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
  | { allow: false; reason: 'not-member' | 'not-manager' | 'not-owner' | 'not-instance-admin' }

const ALLOW: Decision = { allow: true }
const deny = (reason: Extract<Decision, { allow: false }>['reason']): Decision => ({
  allow: false,
  reason,
})

/** Members of the workspace may read it. */
export function canReadWorkspace(actor: Actor): Decision {
  return actor.role === undefined ? deny('not-member') : ALLOW
}

/** Members may read a team of their workspace. */
export function canReadTeam(actor: Actor): Decision {
  return canReadWorkspace(actor)
}

/** Owners and admins change a workspace's settings. */
export function canManageWorkspace(actor: Actor): Decision {
  const read = canReadWorkspace(actor)
  if (!read.allow) return read
  return canManage(actor.role) ? ALLOW : deny('not-manager')
}

/** Owners and admins change a team's settings, rules and integrations. */
export function canWriteTeam(actor: Actor): Decision {
  return canManageWorkspace(actor)
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
