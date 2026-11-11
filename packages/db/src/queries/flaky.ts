import {
  FLAKY_WINDOW,
  flakyScreenshots,
  type FlakyBuild,
  type FlakyReason,
  type FlakyShot,
  type FlakyVerdict,
} from '@circi/core'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { screenshotDiffs, screenshots, projects } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * The project's flaky screenshots. The rule is `flakyScreenshots` in `@circi/core`; this file is
 * the one place that loads its input. Every consumer (the flaky list, Triage and its counts, the
 * sidebar, Insights, the merge gate) goes through `loadFlakyHistory`, so they cannot disagree.
 */

/** A default-branch build as the rule sees it, with when it was made (Insights buckets by it). */
export interface FlakyHistoryBuild extends FlakyBuild {
  createdAt: Date
}

/**
 * The most builds read per project: the window is the last 10 distinct commits, and a commit has at
 * most a handful of reruns. A bound, so no project's history is ever scanned in full.
 */
export const FLAKY_HISTORY_MAX_BUILDS = 60
/** The most builds read per project for a date range (Insights), on top of the lead-in before it. */
export const FLAKY_HISTORY_MAX_RANGE_BUILDS = 1000

export namespace loadFlakyHistory {
  export interface Options {
    /** Only builds numbered below this: what the gate knew before the build it gates. */
    beforeNumber?: number
    /** Only builds created before this. */
    until?: Date
    /**
     * Also every build created from here on (up to a bound), plus the lead-in of
     * `FLAKY_HISTORY_MAX_BUILDS` before it, so a window ending anywhere in the range is full.
     */
    since?: Date
  }
}

/**
 * The completed default-branch builds that matter to each project's flaky rule, oldest first. Per
 * project: at most the last `FLAKY_HISTORY_MAX_BUILDS` builds by number (an index range scan that
 * stops at the limit), and for those builds only the screenshots that showed as changed in at
 * least one of them (a name that never changed cannot have flip-flopped or disagreed), with the
 * head image, the score and whether the size changed.
 */
export async function loadFlakyHistory(
  db: Database,
  projectList: readonly { id: string; defaultBranch: string }[],
  options: loadFlakyHistory.Options = {},
): Promise<Map<string, FlakyHistoryBuild[]>> {
  const result = new Map<string, FlakyHistoryBuild[]>(projectList.map((t) => [t.id, []]))
  if (projectList.length === 0) return result
  const refs =
    options.since === undefined
      ? await recentBuilds(db, projectList, options, FLAKY_HISTORY_MAX_BUILDS)
      : [
          ...(await recentBuilds(
            db,
            projectList,
            { ...options, since: undefined },
            FLAKY_HISTORY_MAX_RANGE_BUILDS,
            options.since,
          )),
          ...(await recentBuilds(
            db,
            projectList,
            { ...options, until: options.since, since: undefined },
            FLAKY_HISTORY_MAX_BUILDS,
          )),
        ]
  if (refs.length === 0) return result

  const ids = refs.map((r) => r.id)
  const changedNames = db
    .selectDistinct({ name: screenshotDiffs.name })
    .from(screenshotDiffs)
    .where(and(inArray(screenshotDiffs.buildId, ids), eq(screenshotDiffs.status, 'changed')))
  const rows = await db
    .select({
      buildId: screenshots.buildId,
      name: screenshots.name,
      fileSha256: screenshots.fileSha256,
      score: screenshotDiffs.score,
      sizeChanged: screenshotDiffs.sizeChanged,
      status: screenshotDiffs.status,
    })
    .from(screenshots)
    .leftJoin(
      screenshotDiffs,
      and(
        eq(screenshotDiffs.buildId, screenshots.buildId),
        eq(screenshotDiffs.name, screenshots.name),
      ),
    )
    .where(and(inArray(screenshots.buildId, ids), inArray(screenshots.name, changedNames)))
  const shotsOf = new Map<string, Map<string, FlakyShot>>(ids.map((id) => [id, new Map()]))
  for (const r of rows) {
    shotsOf.get(r.buildId)?.set(r.name, {
      fileSha256: r.fileSha256,
      score: r.score,
      sizeChanged: r.sizeChanged ?? false,
      changed: r.status === 'changed',
    })
  }
  for (const r of refs.toSorted((a, b) => a.number - b.number)) {
    result.get(r.projectId)?.push({
      number: r.number,
      commitSha: r.commitSha,
      createdAt: r.createdAt,
      shots: shotsOf.get(r.id) ?? new Map(),
    })
  }
  return result
}

interface BuildRef {
  id: string
  projectId: string
  number: number
  commitSha: string
  createdAt: Date
}

/** Per project, the newest `cap` completed default-branch builds that fit the options. */
async function recentBuilds(
  db: Database,
  projectList: readonly { id: string }[],
  options: loadFlakyHistory.Options,
  cap: number,
  since?: Date,
): Promise<BuildRef[]> {
  const result: unknown = await db.execute(sql`
    select b.id, b.project_id, b.number, b.commit_sha, b.created_at
    from projects t
    cross join lateral (
      select id, project_id, number, commit_sha, created_at
      from builds
      where project_id = t.id and branch = t.default_branch and status = 'complete'
        ${options.beforeNumber === undefined ? sql`` : sql`and number < ${options.beforeNumber}`}
        ${options.until === undefined ? sql`` : sql`and created_at < ${options.until.toISOString()}::timestamptz`}
        ${since === undefined ? sql`` : sql`and created_at >= ${since.toISOString()}::timestamptz`}
      order by number desc
      limit ${cap}
    ) b
    where t.id in (${sql.join(
      projectList.map((t) => sql`${t.id}`),
      sql`, `,
    )})
  `)
  const rows: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined
  if (!Array.isArray(rows)) return []
  return rows.map((row: unknown): BuildRef => {
    const get = (key: string): unknown => Reflect.get(Object(row), key)
    return {
      id: String(get('id')),
      projectId: String(get('project_id')),
      number: Number(get('number')),
      commitSha: String(get('commit_sha')),
      createdAt: new Date(String(get('created_at'))),
    }
  })
}

export interface FlakyScreenshot {
  name: string
  /** In how many of the recent default-branch commits it showed as changed. */
  changedIn: number
  /** Why it is flaky, with the evidence. */
  reason: FlakyReason
}

/**
 * The flaky screenshots of several projects in one pass, from one bounded history each. `window`
 * is for tests; everything else uses the default (the last 10 commits).
 */
export async function flakyVerdictsFor(
  db: Database,
  projectList: readonly { id: string; defaultBranch: string; flakyAfterChanges: number }[],
  options: loadFlakyHistory.Options & { window?: number } = {},
): Promise<Map<string, { builds: FlakyHistoryBuild[]; flaky: FlakyVerdict[] }>> {
  const { window, ...load } = options
  const history = await loadFlakyHistory(db, projectList, load)
  return new Map(
    projectList.map((t) => {
      const builds = history.get(t.id) ?? []
      return [
        t.id,
        {
          builds,
          flaky: flakyScreenshots(builds, {
            threshold: t.flakyAfterChanges,
            window: window ?? FLAKY_WINDOW,
          }),
        },
      ]
    }),
  )
}

export async function listFlakyScreenshots(
  db: Database,
  projectId: string,
  options: {
    /** Recent default-branch commits to look at. Default 10. */ window?: number
    /** Flip-flops needed. Default: the project's `flakyAfterChanges`. */ minChanges?: number
  } = {},
): Promise<{ builds: number; flaky: FlakyScreenshot[] }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) return { builds: 0, flaky: [] }
  const found = await flakyVerdictsFor(
    db,
    [
      {
        id: project.id,
        defaultBranch: project.defaultBranch,
        flakyAfterChanges: options.minChanges ?? project.flakyAfterChanges,
      },
    ],
    options.window === undefined ? {} : { window: options.window },
  )
  const { builds, flaky } = found.get(project.id) ?? { builds: [], flaky: [] }
  const window = options.window ?? FLAKY_WINDOW
  return {
    // How many commits were looked at: the window, or fewer when the project has fewer.
    builds: Math.min(window, new Set(builds.map((b) => b.commitSha)).size),
    flaky: flaky.map((f) => ({ name: f.name, changedIn: f.changedIn, reason: f.why })),
  }
}
