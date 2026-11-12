import {
  DEFAULT_ASSIGN_TRIAGE_TO_ON_CALL,
  DEFAULT_FLAKY_BLOCKS_MERGE,
  type ProjectColor,
} from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import { getInstanceDefaultRetentionDays } from '#queries/instance-settings.ts'
import { projects, workspaceSettings } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { Database } from '#src/client.ts'

/** A workspace's defaults for its projects (a project may override each one). */

export interface WorkspaceSettings {
  /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
  flakyBlocksMerge: boolean
  /** Whether new triage items are assigned to whoever is on triage. */
  assignTriageToOnCall: boolean
  /** Retention in days that a new project starts with; projects already made keep their own. */
  retentionDays: number
}

export const DEFAULT_RETENTION_DAYS = 30

const DEFAULTS: WorkspaceSettings = {
  flakyBlocksMerge: DEFAULT_FLAKY_BLOCKS_MERGE,
  assignTriageToOnCall: DEFAULT_ASSIGN_TRIAGE_TO_ON_CALL,
  retentionDays: DEFAULT_RETENTION_DAYS,
}

/** The workspace's settings; the defaults (the instance's default retention) when it has never saved any. */
export async function getWorkspaceSettings(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
  return row
    ? {
        flakyBlocksMerge: row.flakyBlocksMerge,
        assignTriageToOnCall: row.assignTriageToOnCall,
        retentionDays: row.retentionDays,
      }
    : {
        ...DEFAULTS,
        retentionDays: await getInstanceDefaultRetentionDays(db, DEFAULTS.retentionDays),
      }
}

/** Each project's own flaky-gate and triage-assignment settings: null when it inherits the workspace's default. */
export async function listProjectFlakyOverrides(
  db: Database,
  workspaceId: string,
  /** Lists only the projects this person may see. */
  viewerId?: string,
): Promise<
  {
    slug: string
    name: string
    color: ProjectColor
    icon: string | null
    flakyBlocksMerge: boolean | null
    assignTriageToOnCall: boolean | null
  }[]
> {
  return db
    .select({
      slug: projects.slug,
      name: projects.name,
      color: projects.color,
      icon: projects.icon,
      flakyBlocksMerge: projects.flakyBlocksMerge,
      assignTriageToOnCall: projects.assignTriageToOnCall,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        viewerId === undefined ? undefined : projectVisibleTo(viewerId, projects),
      ),
    )
    .orderBy(asc(projects.name))
}
