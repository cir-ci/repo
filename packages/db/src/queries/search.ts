import { and, desc, eq, ilike, max, or, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { orgAccepts, type SessionMethod } from '../repositories/auth-settings.ts'
import {
  type BuildStatus,
  builds,
  member,
  organization,
  projects,
  type ReviewStatus,
  screenshots,
} from '../schema/index.ts'

/**
 * Search for the command menu: one query string against an organization's builds, branches,
 * projects and screenshot names, grouped and limited per group. Limited to organizations the
 * user belongs to. Pull request titles are not stored, so a pull request matches by number only.
 */

export const SEARCH_LIMIT = 5

export interface SearchBuild {
  projectSlug: string
  projectName: string
  number: number
  name: string
  branch: string | null
  prNumber: number | null
  status: BuildStatus
  reviewStatus: ReviewStatus
}

export interface SearchBranch {
  projectSlug: string
  projectName: string
  branch: string
  /** The newest build on it. */
  latestBuildNumber: number
}

export interface SearchProject {
  slug: string
  name: string
}

export interface SearchSnapshot {
  projectSlug: string
  projectName: string
  name: string
  /** The newest build that has a screenshot of this name. */
  latestBuildNumber: number
}

export interface SearchResults {
  query: string
  builds: SearchBuild[]
  branches: SearchBranch[]
  projects: SearchProject[]
  snapshots: SearchSnapshot[]
}

/** Escapes `%`, `_` and `\` so the user's text matches literally inside `like`. */
function contains(text: string) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export async function searchOrganization(
  db: Database,
  input: {
    userId: string
    orgSlug: string
    query: string
    limit?: number
    method?: SessionMethod
  },
): Promise<SearchResults | undefined> {
  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, input.userId)),
    )
    .where(and(eq(organization.slug, input.orgSlug), orgAccepts(organization.id, input.method)))
  if (!org) return undefined

  const q = input.query.trim()
  const limit = input.limit ?? SEARCH_LIMIT
  const empty: SearchResults = { query: q, builds: [], branches: [], projects: [], snapshots: [] }
  if (q === '') return empty

  const like = contains(q)
  // "#148" and "148" both mean build 148 (and pull request 148).
  const numeric = /^#?(\d{1,9})$/.exec(q)
  const n = numeric ? Number(numeric[1]) : undefined
  const inOrg = eq(projects.orgId, org.id)

  const [buildRows, branchRows, projectRows, snapshotRows] = await Promise.all([
    db
      .select({
        projectSlug: projects.slug,
        projectName: projects.name,
        number: builds.number,
        name: builds.name,
        branch: builds.branch,
        prNumber: builds.prNumber,
        status: builds.status,
        reviewStatus: builds.reviewStatus,
      })
      .from(builds)
      .innerJoin(projects, eq(projects.id, builds.projectId))
      .where(
        and(inOrg, n === undefined ? sql`false` : or(eq(builds.number, n), eq(builds.prNumber, n))),
      )
      .orderBy(desc(builds.createdAt), desc(builds.number))
      .limit(limit),
    db
      .select({
        projectSlug: projects.slug,
        projectName: projects.name,
        branch: builds.branch,
        latestBuildNumber: max(builds.number),
        latest: max(builds.createdAt),
      })
      .from(builds)
      .innerJoin(projects, eq(projects.id, builds.projectId))
      .where(and(inOrg, ilike(builds.branch, like)))
      .groupBy(projects.slug, projects.name, builds.branch)
      .orderBy(desc(max(builds.createdAt)), projects.slug)
      .limit(limit),
    db
      .select({ slug: projects.slug, name: projects.name })
      .from(projects)
      .where(and(inOrg, or(ilike(projects.name, like), ilike(projects.slug, like))))
      .orderBy(projects.slug)
      .limit(limit),
    db
      .select({
        projectSlug: projects.slug,
        projectName: projects.name,
        name: screenshots.name,
        latestBuildNumber: max(builds.number),
      })
      .from(screenshots)
      .innerJoin(builds, eq(builds.id, screenshots.buildId))
      .innerJoin(projects, eq(projects.id, builds.projectId))
      .where(and(inOrg, ilike(screenshots.name, like)))
      .groupBy(projects.slug, projects.name, screenshots.name)
      .orderBy(desc(max(builds.createdAt)), screenshots.name)
      .limit(limit),
  ])

  return {
    query: q,
    builds: buildRows,
    branches: branchRows.flatMap(({ latest: _latest, branch, latestBuildNumber, ...rest }) =>
      branch === null || latestBuildNumber === null ? [] : [{ ...rest, branch, latestBuildNumber }],
    ),
    projects: projectRows,
    snapshots: snapshotRows.flatMap((r) =>
      r.latestBuildNumber === null ? [] : [{ ...r, latestBuildNumber: r.latestBuildNumber }],
    ),
  }
}
