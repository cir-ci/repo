import { rotationFor } from '@circi/core'
import { type Build, type Database } from '@circi/db'
import { getBuildByNumber, getProjectById, listTriage } from '@circi/db/queries'
import {
  autoAssignTriageItems,
  getRotationForResolution,
  listProjectsAssigningToOnCall,
} from '@circi/db/repositories'

import { notify } from '#src/notifications/notifications.ts'

/**
 * "Assign new triage items to whoever is on triage" (a workspace default, a project override). The
 * queue is derived from builds, so nothing stores which items exist; what is stored is who has
 * each (`triage_items`) and whether a person or this rule chose. The rule runs when:
 *
 *   - a default-branch build finishes or fails (`autoAssignAfterBuild`, from `completeBuild` and
 *     `failBuild`): new items appear
 *   - the setting is turned on, or the rotation is replaced (`changeProjectSettings`,
 *     `updateWorkspaceSettings`, `replaceTriageRotation`)
 *   - every few minutes in the worker (`autoAssignAllProjects`): the handover on Monday, and items
 *     whose snooze ended
 *
 * It never overrides a person: an item somebody assigned or unassigned stays as they left it.
 */

/** Hands every open, unsnoozed item that is nobody's to the person on triage; returns how many. */
export async function autoAssignTriage(
  db: Database,
  input: { projectId: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    if ((await listProjectsAssigningToOnCall(tx, { projectId: input.projectId })).length === 0)
      return 0
    const rotation = await getRotationForResolution(tx, input.projectId)
    const onTriage = rotation ? rotationFor(now, rotation.memberIds, rotation.startsOn) : null
    if (!onTriage) return 0
    const queue = await listTriage(tx, { projectId: input.projectId, now })
    // Nobody's, or an earlier automatic pick for someone else (the handover). The store makes
    // the final call: it leaves an item a person unassigned alone.
    const candidates = queue.items.filter(
      (i) => !i.snoozed && (i.assignee === null || (i.assignee.auto && i.assignee.id !== onTriage)),
    )
    if (candidates.length === 0) return 0
    const changed = await autoAssignTriageItems(tx, {
      projectId: input.projectId,
      assigneeId: onTriage,
      items: candidates.map((i) => ({ kind: i.kind, key: i.key })),
    })
    const first = candidates.find((i) => changed.some((c) => c.kind === i.kind && c.key === i.key))
    if (!first) return 0
    const build = await getBuildByNumber(tx, input.projectId, first.build.number)
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

/** After a build ended on the project's default branch: new items may have appeared. */
export async function autoAssignAfterBuild(db: Database, build: Build, now?: Date): Promise<void> {
  const project = await getProjectById(db, build.projectId)
  if (!project || build.branch !== project.defaultBranch) return
  await autoAssignTriage(db, { projectId: project.id, ...(now ? { now } : {}) })
}

/** Every project that has the setting on and a rotation; returns how many items were assigned. */
export async function autoAssignAllProjects(
  db: Database,
  input: { now?: Date } = {},
): Promise<number> {
  let assigned = 0
  for (const projectId of await listProjectsAssigningToOnCall(db)) {
    // eslint-disable-next-line no-await-in-loop -- one project at a time, each its own transaction
    assigned += await autoAssignTriage(db, { projectId, ...input })
  }
  return assigned
}

/** Every project of a workspace that has the setting on: the workspace's default just changed. */
export async function autoAssignWorkspace(db: Database, workspaceId: string): Promise<void> {
  for (const projectId of await listProjectsAssigningToOnCall(db, { workspaceId })) {
    // eslint-disable-next-line no-await-in-loop -- one project at a time
    await autoAssignTriage(db, { projectId })
  }
}
