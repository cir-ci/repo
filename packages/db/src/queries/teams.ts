import type { TeamColor } from '@circi/core'
import { and, eq } from 'drizzle-orm'

import { member, workspace, teams } from '#schema/index.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'

import { listBuildsForTeam } from './builds.ts'

/**
 * Team read models for the dashboard. Everything a user can reach is limited to the
 * workspaces they're a member of (PLAN §8: workspace isolation).
 */

export interface TeamOverview {
  workspace: { slug: string; name: string }
  team: { slug: string; name: string; defaultBranch: string; color: TeamColor; icon: string | null }
  latestBuild: listBuildsForTeam.Item | null
}

/** Teams in the workspaces `userId` belongs to, with each one's latest build. */
export async function listTeamsOverview(
  db: Database,
  userId: string,
  method?: SessionMethod,
): Promise<TeamOverview[]> {
  const rows = await db
    .select({ workspace: workspace, team: teams })
    .from(teams)
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, userId)))
    .where(workspaceAccepts(workspace.id, method))
    .orderBy(workspace.slug, teams.slug)
  return Promise.all(
    rows.map(async ({ workspace: owner, team }) => {
      const [latest] = await listBuildsForTeam(db, team.id, { limit: 1 })
      return {
        workspace: { slug: owner.slug, name: owner.name },
        team: {
          slug: team.slug,
          name: team.name,
          defaultBranch: team.defaultBranch,
          color: team.color,
          icon: team.icon,
        },
        latestBuild: latest ?? null,
      }
    }),
  )
}
