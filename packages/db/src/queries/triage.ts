import {
  FLAKY_WINDOW,
  lastCommits,
  rotationFor,
  rotationHandover,
  type FlakyReason,
} from '@circi/core'
import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm'

import {
  builds,
  workspace,
  projects,
  screenshotDiffs,
  snapshotReviews,
  type SnoozeKind,
  type TriageKind,
  triageItems,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

import { flakyVerdictsFor, type FlakyHistoryBuild } from './flaky.ts'
import { getTriageRotation, latestDefaultBranchBuildNumber } from './triage-rotation.ts'

/**
 * A project's triage queue: the problems on its default branch that nobody has dealt with.
 * They are derived from builds each time (nothing is stored until someone acts on one):
 *
 *   flaky        a screenshot that keeps coming back to an earlier image on the default branch, or
 *                differs across runs of one commit (`flakyScreenshots` in `@circi/core`, loaded once
 *                by `flakyVerdictsFor`); the build is the latest one where it changed
 *   no_baseline  a screenshot whose only default-branch builds had no baseline to compare with
 *   failed       a default-branch build that ended in error and has not been followed by one that
 *                completed
 *
 * Integration problems (a git connection that needs attention) are not queue items: they belong
 * to the workspace, which has its own banner and the Inbox, not to one project's triage.
 */

export namespace listTriage {
  export interface Item {
    kind: TriageKind
    /** What identifies the problem within its kind: the snapshot name, or `build:<number>`. */
    key: string
    /** The screenshot it is about; null for a failed build. */
    snapshotName: string | null
    project: { slug: string; name: string }
    build: {
      number: number
      branch: string | null
      commitSha: string
      status: Build['status']
      createdAt: Date
    }
    /** `auto`: put there by the on-triage setting, not by a person. */
    assignee: { id: string; name: string; image: string | null; auto: boolean } | null
    /** When a timed snooze ends; null when not snoozed or snoozed until the next push. */
    snoozedUntil: Date | null
    snoozeKind: SnoozeKind | null
    /** Whether the item is snoozed right now (and so belongs under Snoozed, not in the queue). */
    snoozed: boolean
    /**
     * A flaky item's last default-branch commits, oldest first (a commit's reruns are one entry,
     * numbered by its latest build), and whether it changed in each.
     */
    history: { number: number; changed: boolean }[]
    /** Why a flaky item is flaky, with the evidence; null for the other kinds. */
    reason: FlakyReason | null
    /** Why a failed build ended in error; null otherwise. */
    error: string | null
    /** Pull requests whose latest build shows a flaky screenshot as changed, review pending. */
    blocking: number
  }

  export interface Queue {
    items: listTriage.Item[]
    rotation: {
      members: { id: string; name: string; image: string | null }[]
      /** Who is on triage this week; null without a rotation. */
      onTriage: { id: string; name: string; image: string | null } | null
      /** When the turn passes to the next person; null without a rotation. */
      until: Date | null
    }
  }
}

const KIND_ORDER: Record<TriageKind, number> = { flaky: 0, no_baseline: 1, failed: 2 }

type BuildRef = listTriage.Item['build']

/**
 * For each name, the window's commits (oldest first; reruns of a commit are one entry numbered by
 * its latest build) and whether it changed in each. From the history `flakyVerdictsFor` already
 * loaded, so no further query.
 */
function flakyHistory(
  window: readonly FlakyHistoryBuild[],
  names: readonly string[],
): Map<string, { number: number; changed: boolean }[]> {
  const commits = lastCommits(window, FLAKY_WINDOW)
  return new Map(
    names.map((name) => [
      name,
      commits.map((c) => ({
        number: Math.max(...c.runs.map((r) => r.number)),
        changed: c.runs.some((r) => r.shots.get(name)?.changed === true),
      })),
    ]),
  )
}

/** The latest default-branch build in the window where the name changed. */
function latestChange(window: readonly FlakyHistoryBuild[], name: string) {
  return window.findLast((b) => b.shots.get(name)?.changed === true)
}

/** For each name, how many pull requests show it as changed in their latest build, still pending. */
async function flakyBlocking(
  db: Database,
  projectId: string,
  names: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (names.length === 0) return result
  const newer = aliasedTable(builds, 'newer')
  const rows = await db
    .selectDistinct({ name: screenshotDiffs.name, pr: builds.prNumber })
    .from(screenshotDiffs)
    .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
    .where(
      and(
        eq(builds.projectId, projectId),
        isNotNull(builds.prNumber),
        eq(builds.status, 'complete'),
        eq(builds.reviewStatus, 'pending'),
        eq(screenshotDiffs.status, 'changed'),
        inArray(screenshotDiffs.name, names),
        notExists(
          db
            .select({ one: sql`1` })
            .from(newer)
            .where(
              and(
                eq(newer.projectId, projectId),
                eq(newer.prNumber, builds.prNumber),
                gt(newer.number, builds.number),
              ),
            ),
        ),
      ),
    )
  for (const r of rows) result.set(r.name, (result.get(r.name) ?? 0) + 1)
  return result
}

/** Dismissed items are left out; snoozed ones are included and marked. Newest problems first. */
export async function listTriage(
  db: Database,
  input: { projectId: string; now: Date },
): Promise<listTriage.Queue> {
  const [row] = await db
    .select({ project: projects, workspaceSlug: workspace.slug })
    .from(projects)
    .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
    .where(eq(projects.id, input.projectId))
  if (!row) return { items: [], rotation: { members: [], onTriage: null, until: null } }
  const { project } = row
  const projectRef = { slug: project.slug, name: project.name }
  const branch = project.defaultBranch

  const found: {
    kind: TriageKind
    key: string
    snapshotName: string | null
    build: BuildRef
    error?: string | null
  }[] = []

  const buildRef = {
    number: builds.number,
    branch: builds.branch,
    commitSha: builds.commitSha,
    status: builds.status,
    createdAt: builds.createdAt,
  }

  // Flaky: one bounded history, the one rule; the latest build in which each flaky name changed.
  const { builds: window, flaky } = (await flakyVerdictsFor(db, [project])).get(project.id) ?? {
    builds: [],
    flaky: [],
  }
  const flakyNames = flaky.map((f) => f.name)
  const reasons = new Map(flaky.map((f) => [f.name, f.why]))
  const history = flakyHistory(window, flakyNames)
  const blocking = await flakyBlocking(db, project.id, flakyNames)
  for (const f of flaky) {
    const latest = latestChange(window, f.name) ?? window.at(-1)
    if (!latest) continue
    found.push({
      kind: 'flaky',
      key: f.name,
      snapshotName: f.name,
      build: {
        number: latest.number,
        branch,
        commitSha: latest.commitSha,
        status: 'complete',
        createdAt: latest.createdAt,
      },
    })
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
        eq(builds.projectId, project.id),
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
                eq(later.projectId, project.id),
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
    .select({ ...buildRef, error: builds.errorMessage })
    .from(builds)
    .where(
      and(
        eq(builds.projectId, project.id),
        eq(builds.branch, branch),
        eq(builds.status, 'error'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(later)
            .where(
              and(
                eq(later.projectId, project.id),
                eq(later.branch, branch),
                eq(later.status, 'complete'),
                gt(later.number, builds.number),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(builds.number))
  for (const { error, ...b } of failed) {
    found.push({ kind: 'failed', key: `build:${b.number}`, snapshotName: null, build: b, error })
  }

  // What people did about them.
  const states = await db
    .select({ item: triageItems, assignee: { id: user.id, name: user.name, image: user.image } })
    .from(triageItems)
    .leftJoin(user, eq(user.id, triageItems.assigneeId))
    .where(eq(triageItems.projectId, project.id))
  const stateOf = new Map(states.map((s) => [`${s.item.kind}\u0000${s.item.key}`, s]))
  const latestPush = found.length > 0 ? await latestDefaultBranchBuildNumber(db, project.id) : 0

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
      project: projectRef,
      build: f.build,
      assignee: s?.assignee?.id
        ? {
            id: s.assignee.id,
            name: s.assignee.name,
            image: s.assignee.image,
            auto: s.item.assignmentSource === 'auto',
          }
        : null,
      snoozedUntil: snoozed ? until : null,
      snoozeKind: snoozed ? kind : null,
      snoozed,
      history: f.kind === 'flaky' ? (history.get(f.key) ?? []) : [],
      reason: f.kind === 'flaky' ? (reasons.get(f.key) ?? null) : null,
      error: f.error ?? null,
      blocking: f.kind === 'flaky' ? (blocking.get(f.key) ?? 0) : 0,
    })
  }
  items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.build.number - a.build.number ||
      a.key.localeCompare(b.key),
  )

  const rotation = await getTriageRotation(db, project.id)
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
 * How many awake items of the given projects' queues are assigned to the person. Assignments are the
 * only stored part of an item, so only the projects where this person has one are read.
 */
export async function countAssignedTriage(
  db: Database,
  input: { userId: string; projectIds: readonly string[]; now: Date },
): Promise<number> {
  if (input.projectIds.length === 0) return 0
  const rows = await db
    .selectDistinct({ projectId: triageItems.projectId })
    .from(triageItems)
    .where(
      and(
        eq(triageItems.assigneeId, input.userId),
        isNull(triageItems.dismissedAt),
        inArray(triageItems.projectId, [...input.projectIds]),
      ),
    )
  const queues = await Promise.all(
    rows.map((r) => listTriage(db, { projectId: r.projectId, now: input.now })),
  )
  return queues.reduce(
    (sum, q) => sum + q.items.filter((i) => !i.snoozed && i.assignee?.id === input.userId).length,
    0,
  )
}

/**
 * How many items wait in each project's queue of a workspace (not snoozed, not dismissed), in one
 * query: the sidebar needs every project's number and must not run a triage list per project. The
 * counts equal `listTriage(...).items.filter(i => !i.snoozed).length` for each project; projects with
 * nothing waiting are in the map with 0. The three kinds mirror `listTriage`: the flaky names
 * come from the same rule over the same bounded history (`flakyVerdictsFor`, not SQL, so the two
 * cannot disagree) and go into the query as data; the orphan and failed rules are the same, then
 * what people did about them is applied the same way (dismissed out, snoozed out while their
 * snooze lasts).
 */
export async function countOpenTriage(
  db: Database,
  input: { workspaceId: string; now: Date },
): Promise<Map<string, number>> {
  const workspaceProjects = await db
    .select({
      id: projects.id,
      defaultBranch: projects.defaultBranch,
      flakyAfterChanges: projects.flakyAfterChanges,
    })
    .from(projects)
    .where(eq(projects.workspaceId, input.workspaceId))
  const verdicts = await flakyVerdictsFor(db, workspaceProjects)
  const flakyKeys = JSON.stringify(
    workspaceProjects.flatMap((t) =>
      (verdicts.get(t.id)?.flaky ?? []).map((f) => ({ project_id: t.id, key: f.name })),
    ),
  )
  const result: unknown = await db.execute(sql`
    with ws_projects as (
      select id, default_branch, flaky_after_changes from projects where workspace_id = ${input.workspaceId}
    ),
    main_builds as (
      select b.id, b.project_id, b.number, b.status, b.baseline_source, b.review_status, b.conclusion
      from builds b join ws_projects t on t.id = b.project_id and b.branch = t.default_branch
    ),
    latest_push as (
      select project_id, max(number) as n from main_builds group by project_id
    ),
    last_complete as (
      select project_id, max(number) as n from main_builds where status = 'complete' group by project_id
    ),
    found as (
      select (x->>'project_id')::uuid as project_id, 'flaky'::text as kind, x->>'key' as key
      from jsonb_array_elements(${flakyKeys}::jsonb) x
      union
      select mb.project_id, 'no_baseline', d.name
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
          where lb.project_id = mb.project_id and lb.status = 'complete'
            and lb.number > mb.number and ld.name = d.name)
      union
      select mb.project_id, 'failed', 'build:' || mb.number
      from main_builds mb
      where mb.status = 'error'
        and coalesce((select n from last_complete lc where lc.project_id = mb.project_id), 0) <= mb.number
    )
    select t.id as project_id,
      (count(f.key) filter (where i.dismissed_at is null
        and not (i.snooze_kind is not null
          and case when i.snoozed_until is not null
                then i.snoozed_until > ${input.now.toISOString()}::timestamptz
                else coalesce(lp.n, 0) <= coalesce(i.snoozed_after_build, 0) end)))::int as open
    from ws_projects t
    left join found f on f.project_id = t.id
    left join triage_items i on i.project_id = f.project_id and i.kind = f.kind and i.key = f.key
    left join latest_push lp on lp.project_id = t.id
    group by t.id
  `)
  const rows: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined
  if (!Array.isArray(rows)) return new Map()
  return new Map(
    rows.map((row: unknown) => [
      String(Reflect.get(Object(row), 'project_id')),
      Number(Reflect.get(Object(row), 'open')),
    ]),
  )
}
