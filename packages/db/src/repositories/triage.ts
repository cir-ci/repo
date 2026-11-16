import { ValidationError } from '@circi/core'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { getTriageRotation } from '#queries/triage-rotation.ts'
import {
  member,
  projectMembers,
  projects,
  TRIAGE_KINDS,
  triageItems,
  triageRotationMembers,
} from '#schema/index.ts'
import type { AssignmentSource, SnoozeKind, TriageKind } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Triage state: what people did about a project's problems (assigned, snoozed, dismissed), and
 * who takes turns being on triage. The problems themselves are derived when read, see
 * `listTriage` in `queries/triage.ts`. Data only; the services in `@circi/services` pick the
 * snooze end time and own the transaction.
 */

export namespace TriageItem {
  export type Row = typeof triageItems.$inferSelect

  /** What a person sees of an item nobody has touched (no row): its reference and the empty state. */
  export type Untouched = Pick<Row, 'kind' | 'key'> & TriageState

  export interface Ref {
    projectId: string
    kind: string
    key: string
  }
}

export function checkRef(ref: TriageItem.Ref): TriageKind {
  const kind = TRIAGE_KINDS.find((k) => k === ref.kind)
  if (!kind) throw new ValidationError(`Unknown triage kind "${ref.kind}"`)
  if (!ref.key || ref.key.length > 500) throw new ValidationError('A triage item key is required')
  return kind
}

async function upsertItem(
  db: Database,
  ref: TriageItem.Ref,
  set: Partial<typeof triageItems.$inferInsert>,
): Promise<TriageItem.Row> {
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

/** Assigns an item to a project member, or to nobody (`assigneeId: null`). */
export async function assignTriageItem(
  db: Database,
  input: TriageItem.Ref & { assigneeId: string | null },
): Promise<TriageItem.Row> {
  if (input.assigneeId !== null) await assertMembers(db, input.projectId, [input.assigneeId])
  // A person chose, even when they chose nobody: the setting leaves the item alone from now on.
  return upsertItem(db, input, { assigneeId: input.assigneeId, assignmentSource: 'manual' })
}

/** Puts an item off (`snoozeKind: null` wakes it). Clears any earlier dismissal. */
export async function snoozeTriageItem(
  db: Database,
  input: TriageItem.Ref & {
    snoozeKind: SnoozeKind | null
    snoozedUntil: Date | null
    /** For `next_push`: the newest default-branch build number now. */
    snoozedAfterBuild: number | null
  },
): Promise<TriageItem.Row> {
  return upsertItem(db, input, {
    snoozeKind: input.snoozeKind,
    snoozedUntil: input.snoozedUntil,
    snoozedAfterBuild: input.snoozedAfterBuild,
    dismissedAt: null,
  })
}

/**
 * Wakes a snoozed item early: only the snooze fields are cleared (a dismissal stays). Update
 * only: an item nobody has touched has no row, and none is made for it (any kind and key would
 * otherwise create one). Returns undefined then.
 */
export async function unsnoozeTriageItem(
  db: Database,
  ref: TriageItem.Ref,
): Promise<TriageItem.Row | undefined> {
  const kind = checkRef(ref)
  const [row] = await db
    .update(triageItems)
    .set({ snoozeKind: null, snoozedUntil: null, snoozedAfterBuild: null })
    .where(
      and(
        eq(triageItems.projectId, ref.projectId),
        eq(triageItems.kind, kind),
        eq(triageItems.key, ref.key),
      ),
    )
    .returning()
  return row
}

/** Dismisses an item: it leaves the queue and stays out. */
export async function dismissTriageItem(
  db: Database,
  ref: TriageItem.Ref,
): Promise<TriageItem.Row> {
  const item = await upsertItem(db, ref, { dismissedAt: new Date() })
  // Dismissed for good: a choice to leave it unassigned does not outlive the item.
  if (item.assigneeId !== null || item.assignmentSource === null) return item
  return upsertItem(db, ref, { assignmentSource: null })
}

/** What a person can do to an item, as it is stored; all empty for an item nobody touched. */
export interface TriageState {
  assigneeId: string | null
  assignmentSource: AssignmentSource | null
  snoozeKind: SnoozeKind | null
  snoozedUntil: Date | null
  snoozedAfterBuild: number | null
  dismissedAt: Date | null
}

/** An item's stored state; the empty state when nobody has touched it. */
export async function getTriageState(db: Database, ref: TriageItem.Ref): Promise<TriageState> {
  const [row] = await db
    .select()
    .from(triageItems)
    .where(
      and(
        eq(triageItems.projectId, ref.projectId),
        eq(triageItems.kind, checkRef(ref)),
        eq(triageItems.key, ref.key),
      ),
    )
  return {
    assigneeId: row?.assigneeId ?? null,
    assignmentSource: row?.assignmentSource ?? null,
    snoozeKind: row?.snoozeKind ?? null,
    snoozedUntil: row?.snoozedUntil ?? null,
    snoozedAfterBuild: row?.snoozedAfterBuild ?? null,
    dismissedAt: row?.dismissedAt ?? null,
  }
}

/** Puts an item's stored state back to `state` (the part of it that `fields` names). */
export async function restoreTriageState(
  db: Database,
  ref: TriageItem.Ref,
  state: Partial<TriageState>,
): Promise<void> {
  await upsertItem(db, ref, state)
}

async function assertMembers(db: Database, projectId: string, userIds: string[]): Promise<void> {
  const found = await db
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, userIds)))
  if (new Set(found.map((r) => r.id)).size !== new Set(userIds).size) {
    throw new ValidationError('Choose a member of this project')
  }
}

/**
 * Replaces the project's rotation. Everyone must be a project member; an empty list
 * switches the rotation off. `startsOn` defaults to now.
 */
export async function setTriageRotation(
  db: Database,
  input: { projectId: string; memberIds: string[]; startsOn?: Date },
): Promise<getTriageRotation.Rotation> {
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
 * no longer in the project. Null `startsOn` (no rotation) comes back with no ids.
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
      projectMembers,
      and(
        eq(projectMembers.projectId, triageRotationMembers.projectId),
        eq(projectMembers.userId, triageRotationMembers.userId),
      ),
    )
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, projects.workspaceId),
        eq(member.userId, triageRotationMembers.userId),
      ),
    )
    .where(eq(triageRotationMembers.projectId, projectId))
    .orderBy(asc(triageRotationMembers.position))
  return rows.length === 0 ? null : { startsOn: project.startsOn, memberIds: rows.map((r) => r.id) }
}
