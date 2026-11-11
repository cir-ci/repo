import { HOUR_MS, NotFoundError, type SnoozeChoice, snoozeUntil } from '@circi/core'
import { type Database } from '@circi/db'
import {
  getBuildByNumber,
  getProjectById,
  type IgnoreRegionRow,
  latestDefaultBranchBuildNumber,
} from '@circi/db/queries'
import {
  addIgnoreRegion,
  changeIgnoreRegion,
  assignTriageItem,
  dismissTriageItem,
  getTriageState,
  removeIgnoreRegion,
  snoozeTriageItem,
  type TriageItem,
} from '@circi/db/repositories'

import { requeueBuild } from '#src/builds/lifecycle.ts'
import { type UndoToken, recordUndo } from '#src/undo/record.ts'

import { type TriageUndo, triageFields } from './undo.ts'

/**
 * What people do with a project's triage queue. Each function owns its transaction; the queue
 * itself is derived from builds (`listTriage`), so these only record who has it, when it comes
 * back, and that it is done with.
 */

/** Hands an item to a workspace member, or to nobody. */
export async function assignTriage(
  db: Database,
  input: TriageItem.Ref & { assigneeId: string | null },
): Promise<TriageItem.Row> {
  return db.transaction((tx) => assignTriageItem(tx, input))
}

/**
 * Puts an item off. `date` is the end for `choice: 'date'`; `next_push` ends when a new build
 * arrives on the default branch. Without a choice, or a `date` choice with no date, the snooze
 * lasts the project's default (`snoozeDefaultDays`). Returns the stored item and when the snooze
 * ends (null for `next_push`).
 */
export async function snoozeTriage(
  db: Database,
  input: TriageItem.Ref & { choice?: SnoozeChoice; date?: Date | null; now?: Date },
): Promise<{ item: TriageItem.Row; until: Date | null }> {
  const now = input.now ?? new Date()
  const choice = input.choice ?? 'date'
  let date = input.date
  if (choice === 'date' && !date) {
    const project = await getProjectById(db, input.projectId)
    if (!project) throw new NotFoundError('Project not found')
    date = new Date(now.getTime() + project.snoozeDefaultDays * 24 * HOUR_MS)
  }
  const until = snoozeUntil(choice, now, date)
  return db.transaction(async (tx) => {
    const item = await snoozeTriageItem(tx, {
      projectId: input.projectId,
      kind: input.kind,
      key: input.key,
      snoozeKind: choice,
      snoozedUntil: until,
      snoozedAfterBuild:
        choice === 'next_push' ? await latestDefaultBranchBuildNumber(tx, input.projectId) : null,
    })
    return { item, until }
  })
}

/** Takes an item out of the queue for good. */
export async function dismissTriage(db: Database, ref: TriageItem.Ref): Promise<TriageItem.Row> {
  return db.transaction((tx) => dismissTriageItem(tx, ref))
}

type Undoable<T> = T & { undo: UndoToken | null }

/**
 * `assignTriage`, `snoozeTriage` and `dismissTriage` for a person at the dashboard: the same
 * change, in one transaction with a record of the item as it was, and a token that puts it back
 * (`undoAction`; refused when somebody changed the item since). No token when nothing changed.
 */
export async function assignTriageUndoable(
  db: Database,
  input: TriageItem.Ref & { assigneeId: string | null; userId: string },
): Promise<Undoable<{ item: TriageItem.Row }>> {
  const { userId, ...ref } = input
  return db.transaction((tx) =>
    undoable(tx, 'triage_assign', 'assign', userId, ref, () => assignTriageItem(tx, ref)),
  )
}

export async function snoozeTriageUndoable(
  db: Database,
  input: Parameters<typeof snoozeTriage>[1] & { userId: string },
): Promise<Undoable<{ item: TriageItem.Row; until: Date | null }>> {
  const { userId, ...rest } = input
  const { projectId, kind, key } = rest
  return db.transaction(async (tx) => {
    let until: Date | null = null
    const result = await undoable(
      tx,
      'triage_snooze',
      'snooze',
      userId,
      { projectId, kind, key },
      async () => {
        const snoozed = await snoozeTriage(tx, rest)
        until = snoozed.until
        return snoozed.item
      },
    )
    return { ...result, until }
  })
}

export async function dismissTriageUndoable(
  db: Database,
  input: TriageItem.Ref & { userId: string },
): Promise<Undoable<{ item: TriageItem.Row }>> {
  const { userId, ...ref } = input
  return db.transaction((tx) =>
    undoable(tx, 'triage_dismiss', 'dismiss', userId, ref, () => dismissTriageItem(tx, ref)),
  )
}

async function undoable(
  tx: Database,
  kind: 'triage_assign' | 'triage_snooze' | 'triage_dismiss',
  action: Parameters<typeof triageFields>[1],
  userId: string,
  ref: TriageItem.Ref,
  change: () => Promise<TriageItem.Row>,
): Promise<Undoable<{ item: TriageItem.Row }>> {
  const before = await getTriageState(tx, ref)
  const item = await change()
  const previous = triageFields(before, action)
  const after = triageFields(item, action)
  if (JSON.stringify(previous) === JSON.stringify(after)) return { item, undo: null }
  const data: TriageUndo = { kind: ref.kind, key: ref.key, previous, after }
  const undo = await recordUndo(tx, { userId, projectId: ref.projectId, kind, data })
  return { item, undo }
}

/**
 * Compares a failed build again from scratch (a failed item's "Re-run comparison"); the build
 * leaves the queue once it is processing. Any member of the project's workspace may, as for the
 * `/circi rerun` comment. Throws `NotFoundError` for a build that isn't the project's or isn't failed.
 */
export async function rerunFailedBuild(
  db: Database,
  input: { projectId: string; number: number },
): Promise<{ number: number; status: 'processing' }> {
  const build = await getBuildByNumber(db, input.projectId, input.number)
  if (build?.status !== 'error') throw new NotFoundError('Failed build not found')
  await requeueBuild(db, build.id)
  return { number: build.number, status: 'processing' }
}

/**
 * Ignores a rectangle of the screenshots called `name` from now on. When it is the answer to a
 * triage item (`resolves`, usually the flaky item of that snapshot), the item is dismissed in the
 * same transaction.
 */
export async function createIgnoreRegion(
  db: Database,
  input: {
    projectId: string
    name: string
    x: number
    y: number
    width: number
    height: number
    /** Who adds it, shown on the regions list. */
    createdBy?: string
    resolves?: { kind: string; key: string }
  },
): Promise<IgnoreRegionRow> {
  return db.transaction(async (tx) => {
    const { projectId, resolves, ...region } = input
    const added = await addIgnoreRegion(tx, projectId, region)
    if (resolves) await dismissTriageItem(tx, { projectId, ...resolves })
    return added
  })
}

/** Moves, resizes or renames a region; every later comparison uses the new rectangle. */
export async function editIgnoreRegion(
  db: Database,
  projectId: string,
  id: string,
  patch: Parameters<typeof changeIgnoreRegion>[3],
): Promise<IgnoreRegionRow> {
  return db.transaction((tx) => changeIgnoreRegion(tx, projectId, id, patch))
}

/** Stops ignoring a region (throws `NotFoundError` when the project has no such region). */
export async function deleteIgnoreRegion(
  db: Database,
  projectId: string,
  id: string,
): Promise<void> {
  await db.transaction((tx) => removeIgnoreRegion(tx, projectId, id))
}
