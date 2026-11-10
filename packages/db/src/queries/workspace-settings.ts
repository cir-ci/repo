import { DEFAULT_FLAKY_BLOCKS_MERGE } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import { teams, workspaceSettings } from '#schema/index.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

/** A workspace's defaults for its teams (a team may override each one). */

export interface WorkspaceSettings {
  /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
  flakyBlocksMerge: boolean
  /** Retention in days that a new team starts with; teams already made keep their own. */
  retentionDays: number
}

export const DEFAULT_RETENTION_DAYS = 30

const DEFAULTS: WorkspaceSettings = {
  flakyBlocksMerge: DEFAULT_FLAKY_BLOCKS_MERGE,
  retentionDays: DEFAULT_RETENTION_DAYS,
}

/** The workspace's settings; the defaults when it has never saved any. */
export async function getWorkspaceSettings(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
  return row
    ? { flakyBlocksMerge: row.flakyBlocksMerge, retentionDays: row.retentionDays }
    : DEFAULTS
}

/** Each team's own flaky-gate setting: null when it inherits the workspace's default. */
export async function listTeamFlakyOverrides(
  db: Database,
  workspaceId: string,
  /** Lists only the teams this person may see. */
  viewerId?: string,
): Promise<{ slug: string; name: string; flakyBlocksMerge: boolean | null }[]> {
  return db
    .select({ slug: teams.slug, name: teams.name, flakyBlocksMerge: teams.flakyBlocksMerge })
    .from(teams)
    .where(
      and(
        eq(teams.workspaceId, workspaceId),
        viewerId === undefined ? undefined : teamVisibleTo(viewerId, teams),
      ),
    )
    .orderBy(asc(teams.name))
}
