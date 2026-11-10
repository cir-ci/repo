import { type TeamColor, workspacePictureUrl } from '@circi/core'
import { and, eq } from 'drizzle-orm'

import { member, workspace, teams } from '#schema/index.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

import { listBuildsForTeam } from './builds.ts'
import { getTeamMemberSummaries } from './team-members.ts'

/**
 * Team read models for the dashboard. Everything a user can reach is limited to the
 * workspaces they're a member of (PLAN §8: workspace isolation).
 */

export interface TeamOverview {
  workspace: { slug: string; name: string; picture: string | null }
  team: {
    slug: string
    name: string
    defaultBranch: string
    color: TeamColor
    icon: string | null
    /** People in the team. */
    memberCount: number
    /** The first few members, by name (up to five). */
    memberPreview: { id: string; name: string; image: string | null }[]
    /** Whether the person belongs to the team (an owner or admin may see one they don't). */
    youAreMember: boolean
  }
  latestBuild: listBuildsForTeam.Item | null
}

/**
 * The teams `userId` may see (their own, plus every team of the workspaces where they are an
 * owner or admin), with each one's latest build.
 */
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
    .where(and(workspaceAccepts(workspace.id, method), teamVisibleTo(userId, teams)))
    .orderBy(workspace.slug, teams.slug)
  const summaries = await getTeamMemberSummaries(
    db,
    rows.map((r) => r.team.id),
    userId,
  )
  return Promise.all(
    rows.map(async ({ workspace: owner, team }) => {
      const [latest] = await listBuildsForTeam(db, team.id, { limit: 1 })
      return {
        workspace: {
          slug: owner.slug,
          name: owner.name,
          picture: workspacePictureUrl(owner.slug, owner.logo),
        },
        team: {
          slug: team.slug,
          name: team.name,
          defaultBranch: team.defaultBranch,
          color: team.color,
          icon: team.icon,
          memberCount: summaries.get(team.id)?.memberCount ?? 0,
          memberPreview: summaries.get(team.id)?.memberPreview ?? [],
          youAreMember: summaries.get(team.id)?.youAreMember ?? false,
        },
        latestBuild: latest ?? null,
      }
    }),
  )
}
