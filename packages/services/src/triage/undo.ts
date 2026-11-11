import { ConflictError } from '@circi/core'
import type { Database } from '@circi/db'
import { getTriageState, restoreTriageState, type TriageState } from '@circi/db/repositories'

/**
 * Taking back an assignment, a snooze or a dismissal of a triage item. What the action touched is
 * written down as the fields before and after; an undo applies only when those fields still hold
 * what the action set (nobody assigned, snoozed or dismissed the item in between).
 */

type Fields = Partial<Record<keyof TriageState, string | number | null>>

/** What `assignTriageUndoable` and friends record. */
export interface TriageUndo {
  kind: string
  key: string
  previous: Fields
  after: Fields
}

const FIELDS: Record<'assign' | 'snooze' | 'dismiss', (keyof TriageState)[]> = {
  assign: ['assigneeId', 'assignmentSource'],
  snooze: ['snoozeKind', 'snoozedUntil', 'snoozedAfterBuild', 'dismissedAt'],
  dismiss: ['dismissedAt'],
}

const ALL_FIELDS = Object.values(FIELDS).flat()

/** The part of an item's state an action can change, in a form that goes into the record. */
export function triageFields(state: TriageState, action: keyof typeof FIELDS): Fields {
  const out: Fields = {}
  for (const f of FIELDS[action]) {
    const v = state[f]
    out[f] = v instanceof Date ? v.toISOString() : v
  }
  return out
}

export async function undoTriage(tx: Database, data: TriageUndo, projectId: string): Promise<void> {
  const ref = { projectId, kind: data.kind, key: data.key }
  const now = await getTriageState(tx, ref)
  const touched = ALL_FIELDS.filter((f) => f in data.after)
  const same = touched.every((f) => {
    const v = now[f]
    return (v instanceof Date ? v.toISOString() : v) === data.after[f]
  })
  if (!same) throw new ConflictError("Someone changed this item since, so it can't be undone")
  const restore: Partial<TriageState> = {}
  const set = restore as Record<string, string | number | Date | null>
  for (const f of touched) {
    const v = data.previous[f] ?? null
    set[f] =
      typeof v === 'string' && (f === 'snoozedUntil' || f === 'dismissedAt') ? new Date(v) : v
  }
  await restoreTriageState(tx, ref, restore)
}
