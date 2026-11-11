import { ValidationError } from '@circi/core'
import { and, eq, inArray, sql } from 'drizzle-orm'

import {
  member,
  reviewRuleReviewers,
  reviewRules,
  projectMembers,
  projects,
  triageItems,
  triageRotationMembers,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Who belongs to a project. Data only: who may add or remove people is a policy in
 * `@circi/services`, which also opens the transaction these functions run in, so that taking
 * someone off a project and off its rules and rotation is one change.
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
 * Adds people to a project; everyone must belong to the project's workspace (`ValidationError`
 * otherwise, and nobody is added). Someone already in the project stays as they are. Returns the
 * ids that were added now.
 */
export async function addProjectMembers(
  db: Database,
  input: { projectId: string; userIds: string[]; addedBy: string | null },
): Promise<string[]> {
  const userIds = [...new Set(input.userIds)]
  if (userIds.length === 0) return []
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, input.projectId))
  if (!project) throw new ValidationError('That project no longer exists')
  const known = await workspaceMembersAmong(db, project.workspaceId, userIds)
  if (userIds.some((id) => !known.has(id))) {
    throw new ValidationError('Only members of this workspace can join a project')
  }
  const added = await db
    .insert(projectMembers)
    .values(
      userIds.map((userId) => ({ projectId: input.projectId, userId, addedBy: input.addedBy })),
    )
    .onConflictDoNothing()
    .returning({ userId: projectMembers.userId })
  return added.map((r) => r.userId)
}

/**
 * Takes the person off the project's review rules, the triage rotation, its overdue notice and the
 * assignments of its triage items. Past reviews, comments and review requests stay as they are. A rotation that
 * loses its last person is switched off.
 */
async function dropProjectReferences(
  db: Database,
  projectIds: string[],
  userId: string,
): Promise<void> {
  if (projectIds.length === 0) return
  const ruleIds = db
    .select({ id: reviewRules.id })
    .from(reviewRules)
    .where(inArray(reviewRules.projectId, projectIds))
  await db
    .delete(reviewRuleReviewers)
    .where(
      and(eq(reviewRuleReviewers.userId, userId), inArray(reviewRuleReviewers.ruleId, ruleIds)),
    )
  const rotated = await db
    .delete(triageRotationMembers)
    .where(
      and(
        eq(triageRotationMembers.userId, userId),
        inArray(triageRotationMembers.projectId, projectIds),
      ),
    )
    .returning({ projectId: triageRotationMembers.projectId })
  for (const { projectId } of rotated) {
    // oxlint-disable-next-line no-await-in-loop -- a person is on a handful of rotations
    await db
      .update(projects)
      .set({ triageRotationStartsOn: null })
      .where(
        and(
          eq(projects.id, projectId),
          sql`not exists (select 1 from ${triageRotationMembers} where ${triageRotationMembers.projectId} = ${projectId})`,
        ),
      )
  }
  await db
    .update(projects)
    .set({ reviewOverdueNotifyUserId: null })
    .where(and(eq(projects.reviewOverdueNotifyUserId, userId), inArray(projects.id, projectIds)))
  await db
    .update(triageItems)
    .set({ assigneeId: null })
    .where(and(eq(triageItems.assigneeId, userId), inArray(triageItems.projectId, projectIds)))
}

/**
 * Removes a person from a project and from everything that named them for it (see
 * `dropProjectReferences`). False when they were not a member. Removing the last member is allowed.
 */
export async function removeProjectMember(
  db: Database,
  input: { projectId: string; userId: string },
): Promise<boolean> {
  const removed = await db
    .delete(projectMembers)
    .where(
      and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)),
    )
    .returning({ userId: projectMembers.userId })
  await dropProjectReferences(db, [input.projectId], input.userId)
  return removed.length > 0
}

/** Removes a person from every project of a workspace (they left it, or were removed from it). */
export async function removeUserFromWorkspaceProjects(
  db: Database,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, input.workspaceId))
  const projectIds = rows.map((r) => r.id)
  if (projectIds.length === 0) return
  await db
    .delete(projectMembers)
    .where(
      and(eq(projectMembers.userId, input.userId), inArray(projectMembers.projectId, projectIds)),
    )
  await dropProjectReferences(db, projectIds, input.userId)
}
