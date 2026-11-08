import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import { member, workspace, teams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '#src/errors.ts'
import type { Team } from '#src/types.ts'

import { workspaceAccepts, type SessionMethod } from './auth-settings.ts'
import { getWorkspaceBySlug } from './workspaces.ts'

/**
 * Teams, and the lookups the API and dashboard need. A team's CI token is a better-auth
 * API key (`ci_key_id`); issuing and rotating it happens in `@circi/auth`.
 */

export async function createTeam(
  db: Database,
  input: { workspaceSlug: string; name: string; slug?: string; defaultBranch?: string },
): Promise<Team> {
  const found = await getWorkspaceBySlug(db, input.workspaceSlug)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Team name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'team slug')
  const defaultBranch = input.defaultBranch?.trim() || 'main'
  try {
    const [team] = await db
      .insert(teams)
      .values({ workspaceId: found.id, name, slug, defaultBranch })
      .returning()
    if (!team) throw new Error('insert returned no row')
    return team
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`Team "${input.workspaceSlug}/${slug}" already exists`)
    }
    throw err
  }
}

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
  if (!row) throw new NotFoundError(`Team "${input.workspaceSlug}/${input.teamSlug}" not found`)
  return row.team
}

/** Points the team at its current CI key (null after revoking). */
export async function setTeamCiKey(
  db: Database,
  teamId: string,
  ciKeyId: string | null,
): Promise<void> {
  await db.update(teams).set({ ciKeyId }).where(eq(teams.id, teamId))
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

/** A team plus its workspace slug, which dashboard URLs need. */
export async function getTeamContext(
  db: Database,
  teamId: string,
): Promise<getTeamContext.Context | undefined> {
  const [row] = await db
    .select({ team: teams, workspaceSlug: workspace.slug })
    .from(teams)
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .where(eq(teams.id, teamId))
  return row
}

export namespace findTeamForMember {
  export interface Visible {
    id: string
    slug: string
    name: string
    defaultBranch: string
    workspaceSlug: string
    workspaceName: string
  }
}

/**
 * A team by its URL slugs, only if `userId` is a member of its workspace. Anyone else
 * gets the same "not found" as for a team that doesn't exist (PLAN §8: workspace isolation).
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
    defaultBranch: string
    diffThreshold: number
    autoApproveDefaultBranch: boolean
    blockMergeOnChanges: boolean
    /** Whether flaky-only changes block the merge; null inherits the workspace's setting. */
    flakyBlocksMerge: boolean | null
    retentionDays: number
    /** Hours a review request may wait before it is overdue; null means no review target. */
    reviewTargetHours: number | null
    /** Whether CI may upload static sites for this team (needs `STATIC_SITES_HOST`). */
    staticHostingEnabled: boolean
  }
}

export function teamSettings(team: Team): teamSettings.Settings {
  return {
    name: team.name,
    defaultBranch: team.defaultBranch,
    diffThreshold: team.diffThreshold,
    autoApproveDefaultBranch: team.autoApproveDefaultBranch,
    blockMergeOnChanges: team.blockMergeOnChanges,
    flakyBlocksMerge: team.flakyBlocksMerge,
    retentionDays: team.retentionDays,
    reviewTargetHours: team.reviewTargetHours,
    staticHostingEnabled: team.staticHostingEnabled,
  }
}

/** Changes the given settings only; invalid values are a `ValidationError`. */
export async function updateTeamSettings(
  db: Database,
  teamId: string,
  patch: Partial<teamSettings.Settings>,
): Promise<teamSettings.Settings> {
  const set: Partial<teamSettings.Settings> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new ValidationError('Team name is required')
    set.name = name
  }
  if (patch.defaultBranch !== undefined) {
    const branch = patch.defaultBranch.trim()
    if (!branch) throw new ValidationError('Default branch is required')
    set.defaultBranch = branch
  }
  if (patch.diffThreshold !== undefined) {
    if (!(patch.diffThreshold >= 0 && patch.diffThreshold <= 1)) {
      throw new ValidationError('Diff threshold must be between 0 and 1')
    }
    set.diffThreshold = patch.diffThreshold
  }
  if (patch.retentionDays !== undefined) {
    if (!Number.isInteger(patch.retentionDays) || patch.retentionDays < 1) {
      throw new ValidationError('Retention must be at least 1 day')
    }
    set.retentionDays = patch.retentionDays
  }
  if (patch.reviewTargetHours !== undefined) {
    if (
      patch.reviewTargetHours !== null &&
      (!Number.isInteger(patch.reviewTargetHours) || patch.reviewTargetHours < 1)
    ) {
      throw new ValidationError('The review target must be at least 1 hour, or empty for none')
    }
    set.reviewTargetHours = patch.reviewTargetHours
  }
  if (patch.autoApproveDefaultBranch !== undefined) {
    set.autoApproveDefaultBranch = patch.autoApproveDefaultBranch
  }
  if (patch.blockMergeOnChanges !== undefined) set.blockMergeOnChanges = patch.blockMergeOnChanges
  if (patch.flakyBlocksMerge !== undefined) set.flakyBlocksMerge = patch.flakyBlocksMerge
  if (patch.staticHostingEnabled !== undefined)
    set.staticHostingEnabled = patch.staticHostingEnabled
  if (Object.keys(set).length === 0) {
    const current = await getTeamById(db, teamId)
    if (!current) throw new NotFoundError('Team not found')
    return teamSettings(current)
  }
  const [row] = await db.update(teams).set(set).where(eq(teams.id, teamId)).returning()
  if (!row) throw new NotFoundError('Team not found')
  return teamSettings(row)
}
