import type { BuildFilterValues } from '@circi/core'
import { and, asc, eq, isNull, or } from 'drizzle-orm'

import { savedViews, projects, userPinnedProjects } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { Database } from '#src/client.ts'

/** A person's saved views and pinned projects: reads shared by the sidebar and the repository. */

export interface SavedViewRow {
  id: string
  name: string
  filters: BuildFilterValues
  pinned: boolean
  position: number
  /** Null for a view across the whole workspace. */
  project: { slug: string; name: string } | null
  createdAt: Date
}

export const viewColumns = {
  id: savedViews.id,
  name: savedViews.name,
  filters: savedViews.filters,
  pinned: savedViews.pinned,
  position: savedViews.position,
  createdAt: savedViews.createdAt,
  project: { slug: projects.slug, name: projects.name },
}

/** A person's views in a workspace, in their order (those of a project they can't see left out). */
export async function listSavedViews(
  db: Database,
  input: { userId: string; workspaceId: string },
): Promise<SavedViewRow[]> {
  const rows = await db
    .select(viewColumns)
    .from(savedViews)
    .leftJoin(projects, eq(projects.id, savedViews.projectId))
    .where(
      and(
        eq(savedViews.userId, input.userId),
        eq(savedViews.workspaceId, input.workspaceId),
        // A view of a project the person can no longer see stays out of sight.
        or(isNull(savedViews.projectId), projectVisibleTo(input.userId, projects)),
      ),
    )
    .orderBy(asc(savedViews.position), asc(savedViews.createdAt), asc(savedViews.id))
  return rows
}

/** The ids of the projects a person pinned, in pin order. */
export async function listPinnedProjectIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userPinnedProjects.projectId })
    .from(userPinnedProjects)
    .where(eq(userPinnedProjects.userId, userId))
    .orderBy(asc(userPinnedProjects.position), asc(userPinnedProjects.createdAt))
  return rows.map((r) => r.id)
}
