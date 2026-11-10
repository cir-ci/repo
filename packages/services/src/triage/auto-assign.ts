import { rotationFor } from '@circi/core'
import { type Build, type Database } from '@circi/db'
import { getBuildByNumber, getTeamById, listTriage } from '@circi/db/queries'
import {
  autoAssignTriageItems,
  getRotationForResolution,
  listTeamsAssigningToOnCall,
} from '@circi/db/repositories'

import { notify } from '#src/notifications/notifications.ts'

/**
 * "Assign new triage items to whoever is on triage" (a workspace default, a team override). The
 * queue is derived from builds, so nothing stores which items exist; what is stored is who has
 * each (`triage_items`) and whether a person or this rule chose. The rule runs when:
 *
 *   - a default-branch build finishes or fails (`autoAssignAfterBuild`, from `completeBuild` and
 *     `failBuild`): new items appear
 *   - the setting is turned on, or the rotation is replaced (`changeTeamSettings`,
 *     `updateWorkspaceSettings`, `replaceTriageRotation`)
 *   - every few minutes in the worker (`autoAssignAllTeams`): the handover on Monday, and items
 *     whose snooze ended
 *
 * It never overrides a person: an item somebody assigned or unassigned stays as they left it.
 */

/** Hands every open, unsnoozed item that is nobody's to the person on triage; returns how many. */
export async function autoAssignTriage(
  db: Database,
  input: { teamId: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    if ((await listTeamsAssigningToOnCall(tx, { teamId: input.teamId })).length === 0) return 0
    const rotation = await getRotationForResolution(tx, input.teamId)
    const onTriage = rotation ? rotationFor(now, rotation.memberIds, rotation.startsOn) : null
    if (!onTriage) return 0
    const queue = await listTriage(tx, { teamId: input.teamId, now })
    // Nobody's, or an earlier automatic pick for someone else (the handover). The store makes
    // the final call: it leaves an item a person unassigned alone.
    const candidates = queue.items.filter(
      (i) => !i.snoozed && (i.assignee === null || (i.assignee.auto && i.assignee.id !== onTriage)),
    )
    if (candidates.length === 0) return 0
    const changed = await autoAssignTriageItems(tx, {
      teamId: input.teamId,
      assigneeId: onTriage,
      items: candidates.map((i) => ({ kind: i.kind, key: i.key })),
    })
    const first = candidates.find((i) => changed.some((c) => c.kind === i.kind && c.key === i.key))
    if (!first) return 0
    const build = await getBuildByNumber(tx, input.teamId, first.build.number)
    await notify(tx, {
      userId: onTriage,
      kind: 'triage_assigned',
      buildId: build?.id ?? null,
      actorId: null,
      payload: {
        count: changed.length,
        label: first.snapshotName ?? `Build #${first.build.number}`,
      },
    })
    return changed.length
  })
}

/** After a build ended on the team's default branch: new items may have appeared. */
export async function autoAssignAfterBuild(db: Database, build: Build, now?: Date): Promise<void> {
  const team = await getTeamById(db, build.teamId)
  if (!team || build.branch !== team.defaultBranch) return
  await autoAssignTriage(db, { teamId: team.id, ...(now ? { now } : {}) })
}

/** Every team that has the setting on and a rotation; returns how many items were assigned. */
export async function autoAssignAllTeams(
  db: Database,
  input: { now?: Date } = {},
): Promise<number> {
  let assigned = 0
  for (const teamId of await listTeamsAssigningToOnCall(db)) {
    // eslint-disable-next-line no-await-in-loop -- one team at a time, each its own transaction
    assigned += await autoAssignTriage(db, { teamId, ...input })
  }
  return assigned
}

/** Every team of a workspace that has the setting on: the workspace's default just changed. */
export async function autoAssignWorkspace(db: Database, workspaceId: string): Promise<void> {
  for (const teamId of await listTeamsAssigningToOnCall(db, { workspaceId })) {
    // eslint-disable-next-line no-await-in-loop -- one team at a time
    await autoAssignTriage(db, { teamId })
  }
}
