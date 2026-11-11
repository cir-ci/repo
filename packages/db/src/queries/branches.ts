import { and, desc, eq, ilike, isNotNull, max } from 'drizzle-orm'

import { builds, projects } from '#schema/index.ts'
import { containsPattern } from '#shared/like.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { SessionMethod } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'

import { visibleWorkspace } from './workspace-builds.ts'

export namespace listBranches {
  export interface Item {
    name: string
    /** When the newest build on the branch was made. */
    lastBuildAt: Date
  }
}

export const BRANCH_LIMIT = 20

/**
 * The branches builds were made on, for the builds list's branch picker: each name once, the
 * most recently built first, those containing `query` (any case) when it is given. One project's, or
 * every project of the workspace's. Builds with no branch are not listed. Undefined when the
 * workspace (or the named project) is not visible to the person.
 */
export async function listBranches(
  db: Database,
  input: {
    userId: string
    workspaceSlug: string
    projectslug?: string | undefined
    method?: SessionMethod | undefined
    query?: string | undefined
    limit?: number | undefined
  },
): Promise<listBranches.Item[] | undefined> {
  const ws = await visibleWorkspace(db, input)
  if (!ws) return undefined
  const [project] = input.projectslug
    ? await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, ws.id),
            eq(projects.slug, input.projectslug),
            projectVisibleTo(input.userId, projects),
          ),
        )
    : []
  if (input.projectslug && !project) return undefined
  const q = input.query?.trim()
  const lastBuildAt = max(builds.createdAt)
  const rows = await db
    .select({ name: builds.branch, lastBuildAt })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .where(
      and(
        eq(projects.workspaceId, ws.id),
        projectVisibleTo(input.userId, projects),
        project ? eq(builds.projectId, project.id) : undefined,
        isNotNull(builds.branch),
        q ? ilike(builds.branch, containsPattern(q)) : undefined,
      ),
    )
    .groupBy(builds.branch)
    .orderBy(desc(lastBuildAt), builds.branch)
    .limit(input.limit ?? BRANCH_LIMIT)
  return rows.flatMap((r) =>
    r.name && r.lastBuildAt ? [{ name: r.name, lastBuildAt: r.lastBuildAt }] : [],
  )
}
