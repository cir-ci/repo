import { ValidationError } from '@circi/core'
import { and, eq, inArray, sql } from 'drizzle-orm'

import {
  member,
  reviewRuleReviewers,
  reviewRules,
  teamMembers,
  teams,
  triageItems,
  triageRotationMembers,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Who belongs to a team. Data only: who may add or remove people is a policy in
 * `@circi/services`, which also opens the transaction these functions run in, so that taking
 * someone off a team and off its rules and rotation is one change.
 */

/** The ids among `userIds` that belong to the workspace. */
async function workspaceMembersAmong(
  db: Database,
  workspaceId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await db
    .select({ id: member.userId })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), inArray(member.userId, userIds)))
  return new Set(rows.map((r) => r.id))
}

/**
 * Adds people to a team; everyone must belong to the team's workspace (`ValidationError`
 * otherwise, and nobody is added). Someone already in the team stays as they are. Returns the
 * ids that were added now.
 */
export async function addTeamMembers(
  db: Database,
  input: { teamId: string; userIds: string[]; addedBy: string | null },
): Promise<string[]> {
  const userIds = [...new Set(input.userIds)]
  if (userIds.length === 0) return []
  const [team] = await db
    .select({ workspaceId: teams.workspaceId })
    .from(teams)
    .where(eq(teams.id, input.teamId))
  if (!team) throw new ValidationError('That team no longer exists')
  const known = await workspaceMembersAmong(db, team.workspaceId, userIds)
  if (userIds.some((id) => !known.has(id))) {
    throw new ValidationError('Only members of this workspace can join a team')
  }
  const added = await db
    .insert(teamMembers)
    .values(userIds.map((userId) => ({ teamId: input.teamId, userId, addedBy: input.addedBy })))
    .onConflictDoNothing()
    .returning({ userId: teamMembers.userId })
  return added.map((r) => r.userId)
}

/**
 * Takes the person off the team's review rules, the triage rotation and the assignments of its
 * triage items. Past reviews, comments and review requests stay as they are. A rotation that
 * loses its last person is switched off.
 */
async function dropTeamReferences(db: Database, teamIds: string[], userId: string): Promise<void> {
  if (teamIds.length === 0) return
  const ruleIds = db
    .select({ id: reviewRules.id })
    .from(reviewRules)
    .where(inArray(reviewRules.teamId, teamIds))
  await db
    .delete(reviewRuleReviewers)
    .where(
      and(eq(reviewRuleReviewers.userId, userId), inArray(reviewRuleReviewers.ruleId, ruleIds)),
    )
  const rotated = await db
    .delete(triageRotationMembers)
    .where(
      and(eq(triageRotationMembers.userId, userId), inArray(triageRotationMembers.teamId, teamIds)),
    )
    .returning({ teamId: triageRotationMembers.teamId })
  for (const { teamId } of rotated) {
    // oxlint-disable-next-line no-await-in-loop -- a person is on a handful of rotations
    await db
      .update(teams)
      .set({ triageRotationStartsOn: null })
      .where(
        and(
          eq(teams.id, teamId),
          sql`not exists (select 1 from ${triageRotationMembers} where ${triageRotationMembers.teamId} = ${teamId})`,
        ),
      )
  }
  await db
    .update(triageItems)
    .set({ assigneeId: null })
    .where(and(eq(triageItems.assigneeId, userId), inArray(triageItems.teamId, teamIds)))
}

/**
 * Removes a person from a team and from everything that named them for it (see
 * `dropTeamReferences`). False when they were not a member. Removing the last member is allowed.
 */
export async function removeTeamMember(
  db: Database,
  input: { teamId: string; userId: string },
): Promise<boolean> {
  const removed = await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)))
    .returning({ userId: teamMembers.userId })
  await dropTeamReferences(db, [input.teamId], input.userId)
  return removed.length > 0
}

/** Removes a person from every team of a workspace (they left it, or were removed from it). */
export async function removeUserFromWorkspaceTeams(
  db: Database,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.workspaceId, input.workspaceId))
  const teamIds = rows.map((r) => r.id)
  if (teamIds.length === 0) return
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.userId, input.userId), inArray(teamMembers.teamId, teamIds)))
  await dropTeamReferences(db, teamIds, input.userId)
}
