import { HOUR_MS, NotFoundError, type SnoozeChoice, snoozeUntil } from '@circi/core'
import { type Database } from '@circi/db'
import {
  getBuildByNumber,
  getTeamById,
  type IgnoreRegionRow,
  latestDefaultBranchBuildNumber,
} from '@circi/db/queries'
import {
  addIgnoreRegion,
  changeIgnoreRegion,
  assignTriageItem,
  dismissTriageItem,
  removeIgnoreRegion,
  snoozeTriageItem,
  type TriageItem,
} from '@circi/db/repositories'

import { requeueBuild } from '#src/builds/lifecycle.ts'

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
 * arrives on the default branch. Without a choice, or a `date` choice with no date, the snooze
 * lasts the team's default (`snoozeDefaultDays`). Returns the stored item and when the snooze
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
    const team = await getTeamById(db, input.teamId)
    if (!team) throw new NotFoundError('Team not found')
    date = new Date(now.getTime() + team.snoozeDefaultDays * 24 * HOUR_MS)
  }
  const until = snoozeUntil(choice, now, date)
  return db.transaction(async (tx) => {
    const item = await snoozeTriageItem(tx, {
      teamId: input.teamId,
      kind: input.kind,
      key: input.key,
      snoozeKind: choice,
      snoozedUntil: until,
      snoozedAfterBuild:
        choice === 'next_push' ? await latestDefaultBranchBuildNumber(tx, input.teamId) : null,
    })
    return { item, until }
  })
}

/** Takes an item out of the queue for good. */
export async function dismissTriage(db: Database, ref: TriageItem.Ref): Promise<TriageItem.Row> {
  return db.transaction((tx) => dismissTriageItem(tx, ref))
}

/**
 * Compares a failed build again from scratch (a failed item's "Re-run comparison"); the build
 * leaves the queue once it is processing. Any member of the team's workspace may, as for the
 * `/circi rerun` comment. Throws `NotFoundError` for a build that isn't the team's or isn't failed.
 */
export async function rerunFailedBuild(
  db: Database,
  input: { teamId: string; number: number },
): Promise<{ number: number; status: 'processing' }> {
  const build = await getBuildByNumber(db, input.teamId, input.number)
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
    teamId: string
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
    const { teamId, resolves, ...region } = input
    const added = await addIgnoreRegion(tx, teamId, region)
    if (resolves) await dismissTriageItem(tx, { teamId, ...resolves })
    return added
  })
}

/** Moves, resizes or renames a region; every later comparison uses the new rectangle. */
export async function editIgnoreRegion(
  db: Database,
  teamId: string,
  id: string,
  patch: Parameters<typeof changeIgnoreRegion>[3],
): Promise<IgnoreRegionRow> {
  return db.transaction((tx) => changeIgnoreRegion(tx, teamId, id, patch))
}

/** Stops ignoring a region (throws `NotFoundError` when the team has no such region). */
export async function deleteIgnoreRegion(db: Database, teamId: string, id: string): Promise<void> {
  await db.transaction((tx) => removeIgnoreRegion(tx, teamId, id))
}
