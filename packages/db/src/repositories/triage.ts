import { ValidationError } from '@circi/core'
import { and, asc, eq, inArray, max } from 'drizzle-orm'

import {
  builds,
  member,
  projects,
  TRIAGE_KINDS,
  triageItems,
  triageRotationMembers,
  user,
} from '#schema/index.ts'
import type { SnoozeKind, TriageKind } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Triage state: what people did about a project's problems (assigned, snoozed, dismissed), and
 * who takes turns being on triage. The problems themselves are derived when read, see
 * `listTriage` in `queries/triage.ts`. Data only; the services in `@circi/services` pick the
 * snooze end time and own the transaction.
 */

export type TriageItemRow = typeof triageItems.$inferSelect

export interface TriageRef {
  projectId: string
  kind: string
  key: string
}

function checkRef(ref: TriageRef): TriageKind {
  const kind = TRIAGE_KINDS.find((k) => k === ref.kind)
  if (!kind) throw new ValidationError(`Unknown triage kind "${ref.kind}"`)
  if (!ref.key || ref.key.length > 500) throw new ValidationError('A triage item key is required')
  return kind
}

async function upsertItem(
  db: Database,
  ref: TriageRef,
  set: Partial<typeof triageItems.$inferInsert>,
): Promise<TriageItemRow> {
  const kind = checkRef(ref)
  const [row] = await db
    .insert(triageItems)
    .values({ projectId: ref.projectId, kind, key: ref.key, ...set })
    .onConflictDoUpdate({
      target: [triageItems.projectId, triageItems.kind, triageItems.key],
      set,
    })
    .returning()
  if (!row) throw new Error('upsert returned no row')
  return row
}

/** Assigns an item to an organization member, or to nobody (`assigneeId: null`). */
export async function assignTriageItem(
  db: Database,
  input: TriageRef & { assigneeId: string | null },
): Promise<TriageItemRow> {
  if (input.assigneeId !== null) await assertMembers(db, input.projectId, [input.assigneeId])
  return upsertItem(db, input, { assigneeId: input.assigneeId })
}

/** Puts an item off (`snoozeKind: null` wakes it). Clears any earlier dismissal. */
export async function snoozeTriageItem(
  db: Database,
  input: TriageRef & {
    snoozeKind: SnoozeKind | null
    snoozedUntil: Date | null
    /** For `next_push`: the newest default-branch build number now. */
    snoozedAfterBuild: number | null
  },
): Promise<TriageItemRow> {
  return upsertItem(db, input, {
    snoozeKind: input.snoozeKind,
    snoozedUntil: input.snoozedUntil,
    snoozedAfterBuild: input.snoozedAfterBuild,
    dismissedAt: null,
  })
}

/** Dismisses an item: it leaves the queue and stays out. */
export async function dismissTriageItem(db: Database, ref: TriageRef): Promise<TriageItemRow> {
  return upsertItem(db, ref, { dismissedAt: new Date() })
}

/** The newest default-branch build number of a project (0 when it has none). */
export async function latestDefaultBranchBuildNumber(
  db: Database,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: max(builds.number) })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .where(and(eq(builds.projectId, projectId), eq(builds.branch, projects.defaultBranch)))
  return row?.n ?? 0
}

async function assertMembers(db: Database, projectId: string, userIds: string[]): Promise<void> {
  const found = await db
    .select({ id: member.userId })
    .from(member)
    .innerJoin(projects, eq(projects.orgId, member.organizationId))
    .where(and(eq(projects.id, projectId), inArray(member.userId, userIds)))
  if (new Set(found.map((r) => r.id)).size !== new Set(userIds).size) {
    throw new ValidationError('Choose a member of this organization')
  }
}

export interface TriageRotation {
  /** Any moment of the first week; null when the project has no rotation. */
  startsOn: Date | null
  members: { id: string; name: string }[]
}

/** The project's rotation: its members in turn order. */
export async function getTriageRotation(db: Database, projectId: string): Promise<TriageRotation> {
  const [project] = await db
    .select({ startsOn: projects.triageRotationStartsOn })
    .from(projects)
    .where(eq(projects.id, projectId))
  const members = await db
    .select({ id: user.id, name: user.name })
    .from(triageRotationMembers)
    .innerJoin(user, eq(user.id, triageRotationMembers.userId))
    .where(eq(triageRotationMembers.projectId, projectId))
    .orderBy(asc(triageRotationMembers.position))
  return { startsOn: members.length > 0 ? (project?.startsOn ?? null) : null, members }
}

/**
 * Replaces the project's rotation. Everyone must be an organization member; an empty list
 * switches the rotation off. `startsOn` defaults to now.
 */
export async function setTriageRotation(
  db: Database,
  input: { projectId: string; memberIds: string[]; startsOn?: Date },
): Promise<TriageRotation> {
  const memberIds = [...new Set(input.memberIds)]
  if (memberIds.length > 50) throw new ValidationError('That is too many people for a rotation')
  if (memberIds.length > 0) await assertMembers(db, input.projectId, memberIds)
  await db.transaction(async (tx) => {
    await tx
      .delete(triageRotationMembers)
      .where(eq(triageRotationMembers.projectId, input.projectId))
    if (memberIds.length > 0) {
      await tx
        .insert(triageRotationMembers)
        .values(
          memberIds.map((userId, position) => ({ projectId: input.projectId, userId, position })),
        )
    }
    await tx
      .update(projects)
      .set({
        triageRotationStartsOn: memberIds.length > 0 ? (input.startsOn ?? new Date()) : null,
      })
      .where(eq(projects.id, input.projectId))
  })
  return getTriageRotation(db, input.projectId)
}

/**
 * The rotation as `rotationFor` wants it: member ids in turn order, leaving out people who are
 * no longer in the organization. Null `startsOn` (no rotation) comes back with no ids.
 */
export async function getRotationForResolution(
  db: Database,
  projectId: string,
): Promise<{ startsOn: Date; memberIds: string[] } | null> {
  const [project] = await db
    .select({ startsOn: projects.triageRotationStartsOn })
    .from(projects)
    .where(eq(projects.id, projectId))
  if (!project?.startsOn) return null
  const rows = await db
    .select({ id: triageRotationMembers.userId })
    .from(triageRotationMembers)
    .innerJoin(projects, eq(projects.id, triageRotationMembers.projectId))
    .innerJoin(
      member,
      and(
        eq(member.organizationId, projects.orgId),
        eq(member.userId, triageRotationMembers.userId),
      ),
    )
    .where(eq(triageRotationMembers.projectId, projectId))
    .orderBy(asc(triageRotationMembers.position))
  return rows.length === 0 ? null : { startsOn: project.startsOn, memberIds: rows.map((r) => r.id) }
}
