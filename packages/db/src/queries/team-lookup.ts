import type { TeamColor } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import { member, teams, workspace } from '#schema/index.ts'
import { type SessionMethod, workspaceAccepts, workspaceIsLive } from '#shared/session-method.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'
import { assertFound } from '#src/errors.ts'
import type { Team } from '#src/types.ts'

import { getWorkspaceBySlug } from './workspaces.ts'

/** Finding teams: by slugs, by id, and the role a user holds in a team's workspace. */

export async function listTeams(db: Database, workspaceSlug: string): Promise<Team[]> {
  const found = await getWorkspaceBySlug(db, workspaceSlug)
  return db.select().from(teams).where(eq(teams.workspaceId, found.id)).orderBy(asc(teams.slug))
}

export async function getTeamBySlugs(
  db: Database,
  input: { workspaceSlug: string; teamSlug: string },
): Promise<Team> {
  const [row] = await db
    .select({ team: teams })
    .from(teams)
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .where(and(eq(workspace.slug, input.workspaceSlug), eq(teams.slug, input.teamSlug)))
  assertFound(row, `Team "${input.workspaceSlug}/${input.teamSlug}" not found`)
  return row.team
}

export async function getTeamById(db: Database, teamId: string): Promise<Team | undefined> {
  const [row] = await db.select().from(teams).where(eq(teams.id, teamId))
  return row
}

export namespace getTeamContext {
  export interface Context {
    team: Team
    workspaceSlug: string
  }
}

/** A team plus its workspace slug, which dashboard URLs need; none if its workspace is deleted. */
export async function getTeamContext(
  db: Database,
  teamId: string,
): Promise<getTeamContext.Context | undefined> {
  const [row] = await db
    .select({ team: teams, workspaceSlug: workspace.slug })
    .from(teams)
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .where(and(eq(teams.id, teamId), workspaceIsLive(workspace.id)))
  return row
}

export namespace findTeamForMember {
  export interface Visible {
    id: string
    slug: string
    name: string
    defaultBranch: string
    color: TeamColor
    icon: string | null
    workspaceSlug: string
    workspaceName: string
  }
}

/**
 * A team by its URL slugs, only if `userId` may see it: they belong to the team, or are an owner
 * or admin of its workspace. Anyone else gets the same "not found" as for a team that doesn't
 * exist (PLAN §8: workspace isolation; teams are visible to their members).
 */
export async function findTeamForMember(
  db: Database,
  input: { workspaceSlug: string; teamSlug: string; userId: string; method?: SessionMethod },
): Promise<findTeamForMember.Visible | undefined> {
  const [row] = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      defaultBranch: teams.defaultBranch,
      color: teams.color,
      icon: teams.icon,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
    })
    .from(teams)
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(
      and(
        eq(workspace.slug, input.workspaceSlug),
        eq(teams.slug, input.teamSlug),
        workspaceAccepts(workspace.id, input.method),
        teamVisibleTo(input.userId, teams),
      ),
    )
  return row
}

/** The member's role in the team's workspace (`owner`, `admin`, `member`), if they belong. */
export async function getTeamMemberRole(
  db: Database,
  teamId: string,
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ role: member.role })
    .from(teams)
    .innerJoin(member, and(eq(member.workspaceId, teams.workspaceId), eq(member.userId, userId)))
    .where(eq(teams.id, teamId))
  return row?.role
}

export namespace teamSettings {
  export interface Settings {
    name: string
    /** The team's address in the dashboard: `<workspace>/<slug>`. */
    slug: string
    defaultBranch: string
    diffThreshold: number
    autoApproveDefaultBranch: boolean
    blockMergeOnChanges: boolean
    /** Whether flaky-only changes block the merge; null inherits the workspace's setting. */
    flakyBlocksMerge: boolean | null
    retentionDays: number
    /** Hours a review request may wait before it is overdue; null means no review target. */
    reviewTargetHours: number | null
    /** Also told when a review request misses its target (a team member); null: nobody. */
    reviewOverdueNotifyUserId: string | null
    /** A newer build on a branch closes the older builds' review requests. */
    closeReviewsOnNewerBuild: boolean
    /** A newer build asks the people the older build's requests asked, again. */
    reRequestOnNewerBuild: boolean
    /** A build with no changes passes without anyone approving it. */
    autoApproveNoChanges: boolean
    /** Rejecting needs a written reason. */
    requireRejectReason: boolean
    /** A screenshot is flaky after this many flip-flops in the last 10 default-branch commits. */
    flakyAfterChanges: number
    /** Days a snoozed triage item stays away when the snooze names no date. */
    snoozeDefaultDays: number
    /** Whether CI may upload static sites for this team (needs `STATIC_SITES_HOST`). */
    staticHostingEnabled: boolean
  }
}

export function teamSettings(team: Team): teamSettings.Settings {
  return {
    name: team.name,
    slug: team.slug,
    defaultBranch: team.defaultBranch,
    diffThreshold: team.diffThreshold,
    autoApproveDefaultBranch: team.autoApproveDefaultBranch,
    blockMergeOnChanges: team.blockMergeOnChanges,
    flakyBlocksMerge: team.flakyBlocksMerge,
    retentionDays: team.retentionDays,
    reviewTargetHours: team.reviewTargetHours,
    reviewOverdueNotifyUserId: team.reviewOverdueNotifyUserId,
    closeReviewsOnNewerBuild: team.closeReviewsOnNewerBuild,
    reRequestOnNewerBuild: team.reRequestOnNewerBuild,
    autoApproveNoChanges: team.autoApproveNoChanges,
    requireRejectReason: team.requireRejectReason,
    flakyAfterChanges: team.flakyAfterChanges,
    snoozeDefaultDays: team.snoozeDefaultDays,
    staticHostingEnabled: team.staticHostingEnabled,
  }
}
