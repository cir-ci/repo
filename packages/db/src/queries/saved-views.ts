import type { BuildFilterValues } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import { savedViews, teams, userPinnedTeams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A person's saved views and pinned teams: reads shared by the sidebar and the repository. */

export interface SavedViewRow {
  id: string
  name: string
  filters: BuildFilterValues
  pinned: boolean
  position: number
  /** Null for a view across the whole workspace. */
  team: { slug: string; name: string } | null
  createdAt: Date
}

export const viewColumns = {
  id: savedViews.id,
  name: savedViews.name,
  filters: savedViews.filters,
  pinned: savedViews.pinned,
  position: savedViews.position,
  createdAt: savedViews.createdAt,
  team: { slug: teams.slug, name: teams.name },
}

/** A person's views in a workspace, in their order. */
export async function listSavedViews(
  db: Database,
  input: { userId: string; workspaceId: string },
): Promise<SavedViewRow[]> {
  const rows = await db
    .select(viewColumns)
    .from(savedViews)
    .leftJoin(teams, eq(teams.id, savedViews.teamId))
    .where(and(eq(savedViews.userId, input.userId), eq(savedViews.workspaceId, input.workspaceId)))
    .orderBy(asc(savedViews.position), asc(savedViews.createdAt), asc(savedViews.id))
  return rows
}

/** The ids of the teams a person pinned, in pin order. */
export async function listPinnedTeamIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userPinnedTeams.teamId })
    .from(userPinnedTeams)
    .where(eq(userPinnedTeams.userId, userId))
    .orderBy(asc(userPinnedTeams.position), asc(userPinnedTeams.createdAt))
  return rows.map((r) => r.id)
}
