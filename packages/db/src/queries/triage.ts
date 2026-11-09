import { rotationFor, rotationHandover } from '@circi/core'
import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm'

import {
  builds,
  workspace,
  teams,
  screenshotDiffs,
  snapshotReviews,
  type SnoozeKind,
  type TriageKind,
  triageItems,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

import { listFlakyScreenshots } from './flaky.ts'
import { getTriageRotation, latestDefaultBranchBuildNumber } from './triage-rotation.ts'

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
    .leftJoin(
      snapshotReviews,
      and(
        eq(snapshotReviews.buildId, screenshotDiffs.buildId),
        eq(snapshotReviews.snapshotName, screenshotDiffs.name),
        isNull(snapshotReviews.supersededAt),
      ),
    )
    .where(
      and(
        eq(builds.teamId, team.id),
        eq(builds.branch, branch),
        eq(builds.status, 'complete'),
        eq(builds.baselineSource, 'none'),
        eq(screenshotDiffs.status, 'added'),
        // Not already a baseline: the same rule as `listBaselines` (a snapshot approved on its
        // own, or undecided in a build that was approved or had no changes and was not rejected).
        or(
          eq(snapshotReviews.decision, 'rejected'),
          and(
            isNull(snapshotReviews.decision),
            ne(builds.reviewStatus, 'approved'),
            or(
              isNull(builds.conclusion),
              ne(builds.conclusion, 'no_changes'),
              eq(builds.reviewStatus, 'rejected'),
            ),
          ),
        ),
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

/**
 * How many items wait in each team's queue of a workspace (not snoozed, not dismissed), in one
 * query: the sidebar needs every team's number and must not run a triage list per team. The
 * counts equal `listTriage(...).items.filter(i => !i.snoozed).length` for each team; teams with
 * nothing waiting are in the map with 0. The three kinds mirror `listTriage` (flaky window 10,
 * at least 3 changes; the same orphan and failed rules), then what people did about them is
 * applied the same way (dismissed out, snoozed out while their snooze lasts).
 */
export async function countOpenTriage(
  db: Database,
  input: { workspaceId: string; now: Date },
): Promise<Map<string, number>> {
  const result: unknown = await db.execute(sql`
    with ws_teams as (
      select id, default_branch from teams where workspace_id = ${input.workspaceId}
    ),
    main_builds as (
      select b.id, b.team_id, b.number, b.status, b.baseline_source, b.review_status, b.conclusion
      from builds b join ws_teams t on t.id = b.team_id and b.branch = t.default_branch
    ),
    latest_push as (
      select team_id, max(number) as n from main_builds group by team_id
    ),
    last_complete as (
      select team_id, max(number) as n from main_builds where status = 'complete' group by team_id
    ),
    recent as (
      select id, team_id from (
        select id, team_id, row_number() over (partition by team_id order by number desc) as rn
        from main_builds where status = 'complete'
      ) r where rn <= 10
    ),
    found as (
      select recent.team_id, 'flaky'::text as kind, d.name as key
      from screenshot_diffs d join recent on recent.id = d.build_id
      where d.status = 'changed'
      group by recent.team_id, d.name having count(*) >= 3
      union
      select mb.team_id, 'no_baseline', d.name
      from screenshot_diffs d join main_builds mb on mb.id = d.build_id
      where mb.status = 'complete' and mb.baseline_source = 'none' and d.status = 'added'
        and not exists (
          select 1 from snapshot_reviews sr
          where sr.build_id = mb.id and sr.snapshot_name = d.name and sr.superseded_at is null
            and sr.decision = 'approved')
        and not (mb.review_status = 'approved' and not exists (
          select 1 from snapshot_reviews sr
          where sr.build_id = mb.id and sr.snapshot_name = d.name and sr.superseded_at is null))
        and not (coalesce(mb.conclusion, '') = 'no_changes' and mb.review_status <> 'rejected' and not exists (
          select 1 from snapshot_reviews sr
          where sr.build_id = mb.id and sr.snapshot_name = d.name and sr.superseded_at is null))
        and not exists (
          select 1 from screenshot_diffs ld join main_builds lb on lb.id = ld.build_id
          where lb.team_id = mb.team_id and lb.status = 'complete'
            and lb.number > mb.number and ld.name = d.name)
      union
      select mb.team_id, 'failed', 'build:' || mb.number
      from main_builds mb
      where mb.status = 'error'
        and coalesce((select n from last_complete lc where lc.team_id = mb.team_id), 0) <= mb.number
    )
    select t.id as team_id,
      (count(f.key) filter (where i.dismissed_at is null
        and not (i.snooze_kind is not null
          and case when i.snoozed_until is not null
                then i.snoozed_until > ${input.now.toISOString()}::timestamptz
                else coalesce(lp.n, 0) <= coalesce(i.snoozed_after_build, 0) end)))::int as open
    from ws_teams t
    left join found f on f.team_id = t.id
    left join triage_items i on i.team_id = f.team_id and i.kind = f.kind and i.key = f.key
    left join latest_push lp on lp.team_id = t.id
    group by t.id
  `)
  const rows: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined
  if (!Array.isArray(rows)) return new Map()
  return new Map(
    rows.map((row: unknown) => [
      String(Reflect.get(Object(row), 'team_id')),
      Number(Reflect.get(Object(row), 'open')),
    ]),
  )
}
