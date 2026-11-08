import { type SnoozeChoice, snoozeUntil } from '@circi/core'
import {
  addIgnoreRegion,
  assignTriageItem,
  type Database,
  dismissTriageItem,
  type IgnoreRegionRow,
  latestDefaultBranchBuildNumber,
  removeIgnoreRegion,
  snoozeTriageItem,
  type TriageItem,
} from '@circi/db'

/**
 * What people do with a team's triage queue. Each function owns its transaction; the queue
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
 * arrives on the default branch. Returns the stored item and when the snooze ends (null for
 * `next_push`).
 */
export async function snoozeTriage(
  db: Database,
  input: TriageItem.Ref & { choice: SnoozeChoice; date?: Date | null; now?: Date },
): Promise<{ item: TriageItem.Row; until: Date | null }> {
  const until = snoozeUntil(input.choice, input.now ?? new Date(), input.date)
  return db.transaction(async (tx) => {
    const item = await snoozeTriageItem(tx, {
      teamId: input.teamId,
      kind: input.kind,
      key: input.key,
      snoozeKind: input.choice,
      snoozedUntil: until,
      snoozedAfterBuild:
        input.choice === 'next_push'
          ? await latestDefaultBranchBuildNumber(tx, input.teamId)
          : null,
    })
    return { item, until }
  })
}

/** Takes an item out of the queue for good. */
export async function dismissTriage(db: Database, ref: TriageItem.Ref): Promise<TriageItem.Row> {
  return db.transaction((tx) => dismissTriageItem(tx, ref))
}

/**
 * Ignores a rectangle of the screenshots called `name` from now on. When it is the answer to a
 * triage item (`resolves`, usually the flaky item of that snapshot), the item is dismissed in the
 * same transaction.
 */
export async function createIgnoreRegion(
  db: Database,
  input: {
    teamId: string
    name: string
    x: number
    y: number
    width: number
    height: number
    resolves?: { kind: string; key: string }
  },
): Promise<IgnoreRegionRow> {
  return db.transaction(async (tx) => {
    const { teamId, resolves, ...region } = input
    const added = await addIgnoreRegion(tx, teamId, region)
    if (resolves) await dismissTriageItem(tx, { teamId, ...resolves })
    return added
  })
}

/** Stops ignoring a region (throws `NotFoundError` when the team has no such region). */
export async function deleteIgnoreRegion(db: Database, teamId: string, id: string): Promise<void> {
  await db.transaction((tx) => removeIgnoreRegion(tx, teamId, id))
}
