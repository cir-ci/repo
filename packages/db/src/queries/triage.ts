import { rotationFor, rotationHandover } from '@circi/core'
import { aliasedTable, and, desc, eq, gt, inArray, notExists, sql } from 'drizzle-orm'

import { listFlakyScreenshots } from '#repositories/flaky.ts'
import { getTriageRotation, latestDefaultBranchBuildNumber } from '#repositories/triage.ts'
import {
  builds,
  workspace,
  teams,
  screenshotDiffs,
  type SnoozeKind,
  type TriageKind,
  triageItems,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/**
 * A team's triage queue: the problems on its default branch that nobody has dealt with.
 * They are derived from builds each time (nothing is stored until someone acts on one):
 *
 *   flaky        a screenshot that keeps changing on the default branch (see `listFlakyScreenshots`);
 *                the build is the latest one where it changed
 *   no_baseline  a screenshot whose only default-branch builds had no baseline to compare with
 *   failed       a default-branch build that ended in error and has not been followed by one that
 *                completed
 *
 * Integration problems (a git connection that needs attention) are not queue items: they belong
 * to the workspace, which has its own banner and the Inbox, not to one team's triage.
 */

export namespace listTriage {
  export interface Item {
    kind: TriageKind
    /** What identifies the problem within its kind: the snapshot name, or `build:<number>`. */
    key: string
    /** The screenshot it is about; null for a failed build. */
    snapshotName: string | null
    team: { slug: string; name: string }
    build: {
      number: number
      branch: string | null
      commitSha: string
      status: Build['status']
      createdAt: Date
    }
    assignee: { id: string; name: string } | null
    /** When a timed snooze ends; null when not snoozed or snoozed until the next push. */
    snoozedUntil: Date | null
    snoozeKind: SnoozeKind | null
    /** Whether the item is snoozed right now (and so belongs under Snoozed, not in the queue). */
    snoozed: boolean
  }

  export interface Queue {
    items: listTriage.Item[]
    rotation: {
      members: { id: string; name: string }[]
      /** Who is on triage this week; null without a rotation. */
      onTriage: { id: string; name: string } | null
      /** When the turn passes to the next person; null without a rotation. */
      until: Date | null
    }
  }
}

const KIND_ORDER: Record<TriageKind, number> = { flaky: 0, no_baseline: 1, failed: 2 }

type BuildRef = listTriage.Item['build']

/** Dismissed items are left out; snoozed ones are included and marked. Newest problems first. */
export async function listTriage(
  db: Database,
  input: { teamId: string; now: Date },
): Promise<listTriage.Queue> {
  const [row] = await db
    .select({ team: teams, workspaceSlug: workspace.slug })
    .from(teams)
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .where(eq(teams.id, input.teamId))
  if (!row) return { items: [], rotation: { members: [], onTriage: null, until: null } }
  const { team } = row
  const teamRef = { slug: team.slug, name: team.name }
  const branch = team.defaultBranch

  const found: { kind: TriageKind; key: string; snapshotName: string | null; build: BuildRef }[] =
    []

  const buildRef = {
    number: builds.number,
    branch: builds.branch,
    commitSha: builds.commitSha,
    status: builds.status,
    createdAt: builds.createdAt,
  }

  // Flaky: the latest default-branch build in which each flaky name changed.
  const { flaky } = await listFlakyScreenshots(db, team.id)
  if (flaky.length > 0) {
    const rows = await db
      .selectDistinctOn([screenshotDiffs.name], { name: screenshotDiffs.name, build: buildRef })
      .from(screenshotDiffs)
      .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
      .where(
        and(
          eq(builds.teamId, team.id),
          eq(builds.branch, branch),
          eq(builds.status, 'complete'),
          eq(screenshotDiffs.status, 'changed'),
          inArray(
            screenshotDiffs.name,
            flaky.map((f) => f.name),
          ),
        ),
      )
      .orderBy(screenshotDiffs.name, desc(builds.number))
    for (const r of rows) {
      found.push({ kind: 'flaky', key: r.name, snapshotName: r.name, build: r.build })
    }
  }

  // No baseline: added on a default-branch build that had nothing to compare with, and never
  // seen again by a later completed default-branch build (which would have compared it).
  const later = aliasedTable(builds, 'later')
  const laterDiff = aliasedTable(screenshotDiffs, 'later_diff')
  const orphans = await db
    .selectDistinctOn([screenshotDiffs.name], { name: screenshotDiffs.name, build: buildRef })
    .from(screenshotDiffs)
    .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
    .where(
      and(
        eq(builds.teamId, team.id),
        eq(builds.branch, branch),
        eq(builds.status, 'complete'),
        eq(builds.baselineSource, 'none'),
        eq(screenshotDiffs.status, 'added'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(laterDiff)
            .innerJoin(later, eq(later.id, laterDiff.buildId))
            .where(
              and(
                eq(later.teamId, team.id),
                eq(later.branch, branch),
                eq(later.status, 'complete'),
                gt(later.number, builds.number),
                eq(laterDiff.name, screenshotDiffs.name),
              ),
            ),
        ),
      ),
    )
    .orderBy(screenshotDiffs.name, desc(builds.number))
  for (const r of orphans) {
    found.push({ kind: 'no_baseline', key: r.name, snapshotName: r.name, build: r.build })
  }

  // Failed: errored default-branch builds with no completed build after them.
  const failed = await db
    .select(buildRef)
    .from(builds)
    .where(
      and(
        eq(builds.teamId, team.id),
        eq(builds.branch, branch),
        eq(builds.status, 'error'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(later)
            .where(
              and(
                eq(later.teamId, team.id),
                eq(later.branch, branch),
                eq(later.status, 'complete'),
                gt(later.number, builds.number),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(builds.number))
  for (const b of failed) {
    found.push({ kind: 'failed', key: `build:${b.number}`, snapshotName: null, build: b })
  }

  // What people did about them.
  const states = await db
    .select({ item: triageItems, assignee: { id: user.id, name: user.name } })
    .from(triageItems)
    .leftJoin(user, eq(user.id, triageItems.assigneeId))
    .where(eq(triageItems.teamId, team.id))
  const stateOf = new Map(states.map((s) => [`${s.item.kind}\u0000${s.item.key}`, s]))
  const latestPush = found.length > 0 ? await latestDefaultBranchBuildNumber(db, team.id) : 0

  const items: listTriage.Item[] = []
  for (const f of found) {
    const s = stateOf.get(`${f.kind}\u0000${f.key}`)
    if (s?.item.dismissedAt) continue
    const kind = s?.item.snoozeKind ?? null
    const until = s?.item.snoozedUntil ?? null
    const snoozed =
      kind !== null &&
      (until !== null
        ? until.getTime() > input.now.getTime()
        : latestPush <= (s?.item.snoozedAfterBuild ?? 0))
    items.push({
      kind: f.kind,
      key: f.key,
      snapshotName: f.snapshotName,
      team: teamRef,
      build: f.build,
      assignee: s?.assignee?.id ? { id: s.assignee.id, name: s.assignee.name } : null,
      snoozedUntil: snoozed ? until : null,
      snoozeKind: snoozed ? kind : null,
      snoozed,
    })
  }
  items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.build.number - a.build.number ||
      a.key.localeCompare(b.key),
  )

  const rotation = await getTriageRotation(db, team.id)
  const onTriage = rotation.startsOn
    ? rotationFor(input.now, rotation.members, rotation.startsOn)
    : null
  return {
    items,
    rotation: {
      members: rotation.members,
      onTriage,
      until: onTriage ? rotationHandover(input.now) : null,
    },
  }
}

/** How many items wait in a team's queue: not snoozed, not dismissed. */
export async function countOpenTriage(
  db: Database,
  input: { teamId: string; now: Date },
): Promise<number> {
  const queue = await listTriage(db, input)
  return queue.items.filter((i) => !i.snoozed).length
}
