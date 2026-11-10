import { ValidationError } from '@circi/core'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { getTriageRotation } from '#queries/triage-rotation.ts'
import {
  member,
  teamMembers,
  teams,
  TRIAGE_KINDS,
  triageItems,
  triageRotationMembers,
} from '#schema/index.ts'
import type { AssignmentSource, SnoozeKind, TriageKind } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Triage state: what people did about a team's problems (assigned, snoozed, dismissed), and
 * who takes turns being on triage. The problems themselves are derived when read, see
 * `listTriage` in `queries/triage.ts`. Data only; the services in `@circi/services` pick the
 * snooze end time and own the transaction.
 */

export namespace TriageItem {
  export type Row = typeof triageItems.$inferSelect

  export interface Ref {
    teamId: string
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
    .values({ teamId: ref.teamId, kind, key: ref.key, ...set })
    .onConflictDoUpdate({
      target: [triageItems.teamId, triageItems.kind, triageItems.key],
      set,
    })
    .returning()
  if (!row) throw new Error('upsert returned no row')
  return row
}

/** Assigns an item to a team member, or to nobody (`assigneeId: null`). */
export async function assignTriageItem(
  db: Database,
  input: TriageItem.Ref & { assigneeId: string | null },
): Promise<TriageItem.Row> {
  if (input.assigneeId !== null) await assertMembers(db, input.teamId, [input.assigneeId])
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
        eq(triageItems.teamId, ref.teamId),
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

async function assertMembers(db: Database, teamId: string, userIds: string[]): Promise<void> {
  const found = await db
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.userId, userIds)))
  if (new Set(found.map((r) => r.id)).size !== new Set(userIds).size) {
    throw new ValidationError('Choose a member of this team')
  }
}

/**
 * Replaces the team's rotation. Everyone must be a team member; an empty list
 * switches the rotation off. `startsOn` defaults to now.
 */
export async function setTriageRotation(
  db: Database,
  input: { teamId: string; memberIds: string[]; startsOn?: Date },
): Promise<getTriageRotation.Rotation> {
  const memberIds = [...new Set(input.memberIds)]
  if (memberIds.length > 50) throw new ValidationError('That is too many people for a rotation')
  if (memberIds.length > 0) await assertMembers(db, input.teamId, memberIds)
  await db.transaction(async (tx) => {
    await tx.delete(triageRotationMembers).where(eq(triageRotationMembers.teamId, input.teamId))
    if (memberIds.length > 0) {
      await tx
        .insert(triageRotationMembers)
        .values(memberIds.map((userId, position) => ({ teamId: input.teamId, userId, position })))
    }
    await tx
      .update(teams)
      .set({
        triageRotationStartsOn: memberIds.length > 0 ? (input.startsOn ?? new Date()) : null,
      })
      .where(eq(teams.id, input.teamId))
  })
  return getTriageRotation(db, input.teamId)
}

/**
 * The rotation as `rotationFor` wants it: member ids in turn order, leaving out people who are
 * no longer in the team. Null `startsOn` (no rotation) comes back with no ids.
 */
export async function getRotationForResolution(
  db: Database,
  teamId: string,
): Promise<{ startsOn: Date; memberIds: string[] } | null> {
  const [team] = await db
    .select({ startsOn: teams.triageRotationStartsOn })
    .from(teams)
    .where(eq(teams.id, teamId))
  if (!team?.startsOn) return null
  const rows = await db
    .select({ id: triageRotationMembers.userId })
    .from(triageRotationMembers)
    .innerJoin(teams, eq(teams.id, triageRotationMembers.teamId))
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, triageRotationMembers.teamId),
        eq(teamMembers.userId, triageRotationMembers.userId),
      ),
    )
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, teams.workspaceId),
        eq(member.userId, triageRotationMembers.userId),
      ),
    )
    .where(eq(triageRotationMembers.teamId, teamId))
    .orderBy(asc(triageRotationMembers.position))
  return rows.length === 0 ? null : { startsOn: team.startsOn, memberIds: rows.map((r) => r.id) }
}
