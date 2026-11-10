import { and, desc, eq, ilike, max, or, sql } from 'drizzle-orm'

import {
  type BuildStatus,
  builds,
  member,
  workspace,
  teams,
  type ReviewStatus,
  screenshots,
} from '#schema/index.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

/**
 * Search for the command menu: one query string against a workspace's builds, branches,
 * teams and screenshot names, grouped and limited per group. Limited to workspaces the
 * user belongs to. Pull request titles are not stored, so a pull request matches by number only.
 */

export const SEARCH_LIMIT = 5

export namespace searchWorkspace {
  export interface Build {
    teamSlug: string
    teamName: string
    number: number
    name: string
    branch: string | null
    prNumber: number | null
    status: BuildStatus
    reviewStatus: ReviewStatus
  }

  export interface Branch {
    teamSlug: string
    teamName: string
    branch: string
    /** The newest build on it. */
    latestBuildNumber: number
  }

  export interface Team {
    slug: string
    name: string
  }

  export interface Snapshot {
    teamSlug: string
    teamName: string
    name: string
    /** The newest build that has a screenshot of this name. */
    latestBuildNumber: number
  }

  export interface Results {
    query: string
    builds: searchWorkspace.Build[]
    branches: searchWorkspace.Branch[]
    teams: searchWorkspace.Team[]
    snapshots: searchWorkspace.Snapshot[]
  }
}

/** Escapes `%`, `_` and `\` so the user's text matches literally inside `like`. */
function contains(text: string) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export async function searchWorkspace(
  db: Database,
  input: {
    userId: string
    workspaceSlug: string
    query: string
    limit?: number
    method?: SessionMethod
  },
): Promise<searchWorkspace.Results | undefined> {
  const [found] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(
      and(eq(workspace.slug, input.workspaceSlug), workspaceAccepts(workspace.id, input.method)),
    )
  if (!found) return undefined

  const q = input.query.trim()
  const limit = input.limit ?? SEARCH_LIMIT
  const empty: searchWorkspace.Results = {
    query: q,
    builds: [],
    branches: [],
    teams: [],
    snapshots: [],
  }
  if (q === '') return empty

  const like = contains(q)
  // "#148" and "148" both mean build 148 (and pull request 148).
  const numeric = /^#?(\d{1,9})$/.exec(q)
  const n = numeric ? Number(numeric[1]) : undefined
  const inWorkspace = and(eq(teams.workspaceId, found.id), teamVisibleTo(input.userId, teams))

  const [buildRows, branchRows, teamRows, snapshotRows] = await Promise.all([
    db
      .select({
        teamSlug: teams.slug,
        teamName: teams.name,
        number: builds.number,
        name: builds.name,
        branch: builds.branch,
        prNumber: builds.prNumber,
        status: builds.status,
        reviewStatus: builds.reviewStatus,
      })
      .from(builds)
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(
        and(
          inWorkspace,
          n === undefined ? sql`false` : or(eq(builds.number, n), eq(builds.prNumber, n)),
        ),
      )
      .orderBy(desc(builds.createdAt), desc(builds.number))
      .limit(limit),
    db
      .select({
        teamSlug: teams.slug,
        teamName: teams.name,
        branch: builds.branch,
        latestBuildNumber: max(builds.number),
        latest: max(builds.createdAt),
      })
      .from(builds)
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(and(inWorkspace, ilike(builds.branch, like)))
      .groupBy(teams.slug, teams.name, builds.branch)
      .orderBy(desc(max(builds.createdAt)), teams.slug)
      .limit(limit),
    db
      .select({ slug: teams.slug, name: teams.name })
      .from(teams)
      .where(and(inWorkspace, or(ilike(teams.name, like), ilike(teams.slug, like))))
      .orderBy(teams.slug)
      .limit(limit),
    db
      .select({
        teamSlug: teams.slug,
        teamName: teams.name,
        name: screenshots.name,
        latestBuildNumber: max(builds.number),
      })
      .from(screenshots)
      .innerJoin(builds, eq(builds.id, screenshots.buildId))
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(and(inWorkspace, ilike(screenshots.name, like)))
      .groupBy(teams.slug, teams.name, screenshots.name)
      .orderBy(desc(max(builds.createdAt)), screenshots.name)
      .limit(limit),
  ])

  return {
    query: q,
    builds: buildRows,
    branches: branchRows.flatMap(({ latest: _latest, branch, latestBuildNumber, ...rest }) =>
      branch === null || latestBuildNumber === null ? [] : [{ ...rest, branch, latestBuildNumber }],
    ),
    teams: teamRows,
    snapshots: snapshotRows.flatMap((r) =>
      r.latestBuildNumber === null ? [] : [{ ...r, latestBuildNumber: r.latestBuildNumber }],
    ),
  }
}
