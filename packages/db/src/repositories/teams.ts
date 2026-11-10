import {
  assertBranchName,
  assertDiffThreshold,
  assertFlakyAfterChanges,
  assertSnoozeDefaultDays,
  assertRetentionDays,
  assertReviewTargetHours,
  assertTeamColor,
  assertTeamIcon,
  assertValidSlug,
  slugify,
  teamColorFor,
  type TeamColor,
  ValidationError,
  assertFound,
} from '@circi/core'
import { and, eq } from 'drizzle-orm'

import { getTeamById, teamSettings } from '#queries/team-lookup.ts'
import { getWorkspaceSettings } from '#queries/workspace-settings.ts'
import { getWorkspaceBySlug } from '#queries/workspaces.ts'
import { teamMembers, teams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'
import type { Team } from '#src/types.ts'

import { addTeamMembers } from './team-members.ts'

/**
 * Teams, and the lookups the API and dashboard need. A team's CI token is a better-auth
 * API key (`ci_key_id`); issuing and rotating it happens in `@circi/auth`.
 */

export async function createTeam(
  db: Database,
  input: {
    workspaceSlug: string
    name: string
    slug?: string
    defaultBranch?: string
    /** A palette colour; from a hash of the name when left out. */
    color?: string
    /** A Lucide icon name from `TEAM_ICON_NAMES`; none shows only the marble. */
    icon?: string | null
    /** Added to the team: the person creating it. */
    createdBy?: string
    /** Added to the team too; each must belong to the workspace. */
    memberIds?: string[]
  },
): Promise<Team> {
  const found = await getWorkspaceBySlug(db, input.workspaceSlug)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Team name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'team slug')
  const defaultBranch = input.defaultBranch?.trim() || 'main'
  assertBranchName(defaultBranch)
  const color = input.color ?? teamColorFor(name)
  assertTeamColor(color)
  const icon = input.icon ?? null
  if (icon !== null) assertTeamIcon(icon)
  // A new team starts with the workspace's default retention; it can change its own after.
  const { retentionDays } = await getWorkspaceSettings(db, found.id)
  try {
    return await db.transaction(async (tx) => {
      const [team] = await tx
        .insert(teams)
        .values({ workspaceId: found.id, name, slug, defaultBranch, color, icon, retentionDays })
        .returning()
      if (!team) throw new Error('insert returned no row')
      const first = input.createdBy === undefined ? [] : [input.createdBy]
      await addTeamMembers(tx, {
        teamId: team.id,
        userIds: [...first, ...(input.memberIds ?? [])],
        addedBy: input.createdBy ?? null,
      })
      return team
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`Team "${input.workspaceSlug}/${slug}" already exists`)
    }
    throw err
  }
}

export namespace setTeamAppearance {
  export interface Appearance {
    color: TeamColor
    icon: string | null
  }
}

/** Changes the team's tile colour and/or icon (`null` clears the icon); invalid values are a `ValidationError`. */
export async function setTeamAppearance(
  db: Database,
  teamId: string,
  patch: { color?: string; icon?: string | null },
): Promise<setTeamAppearance.Appearance> {
  const set: { color?: TeamColor; icon?: string | null } = {}
  if (patch.color !== undefined) {
    assertTeamColor(patch.color)
    set.color = patch.color
  }
  if (patch.icon !== undefined) {
    if (patch.icon !== null) assertTeamIcon(patch.icon)
    set.icon = patch.icon
  }
  if (Object.keys(set).length === 0) {
    const current = await getTeamById(db, teamId)
    assertFound(current, 'Team not found')
    return { color: current.color, icon: current.icon }
  }
  const [row] = await db.update(teams).set(set).where(eq(teams.id, teamId)).returning()
  assertFound(row, 'Team not found')
  return { color: row.color, icon: row.icon }
}

/** Points the team at its current CI key (null after revoking). */
export async function setTeamCiKey(
  db: Database,
  teamId: string,
  ciKeyId: string | null,
  createdBy: string | null = null,
): Promise<void> {
  await db.update(teams).set({ ciKeyId, ciKeyCreatedBy: createdBy }).where(eq(teams.id, teamId))
}

/**
 * Changes the given settings only; invalid values are a `ValidationError`. A new slug must be
 * valid and free in the workspace (`ConflictError`); like a workspace's address, the old one
 * stops working (there is no redirect).
 */
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
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim()
    assertValidSlug(slug, 'team slug')
    set.slug = slug
  }
  if (patch.defaultBranch !== undefined) {
    const branch = patch.defaultBranch.trim()
    assertBranchName(branch)
    set.defaultBranch = branch
  }
  if (patch.diffThreshold !== undefined) {
    assertDiffThreshold(patch.diffThreshold)
    set.diffThreshold = patch.diffThreshold
  }
  if (patch.retentionDays !== undefined) {
    assertRetentionDays(patch.retentionDays)
    set.retentionDays = patch.retentionDays
  }
  if (patch.reviewTargetHours !== undefined) {
    if (patch.reviewTargetHours !== null) assertReviewTargetHours(patch.reviewTargetHours)
    set.reviewTargetHours = patch.reviewTargetHours
  }
  if (patch.reviewOverdueNotifyUserId !== undefined) {
    if (patch.reviewOverdueNotifyUserId !== null) {
      const [row] = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, patch.reviewOverdueNotifyUserId),
          ),
        )
      if (!row) {
        throw new ValidationError('Choose a member of this team', {
          fields: { reviewOverdueNotifyUserId: 'Choose a member of this team' },
        })
      }
    }
    set.reviewOverdueNotifyUserId = patch.reviewOverdueNotifyUserId
  }
  if (patch.flakyAfterChanges !== undefined) {
    assertFlakyAfterChanges(patch.flakyAfterChanges)
    set.flakyAfterChanges = patch.flakyAfterChanges
  }
  if (patch.snoozeDefaultDays !== undefined) {
    assertSnoozeDefaultDays(patch.snoozeDefaultDays)
    set.snoozeDefaultDays = patch.snoozeDefaultDays
  }
  if (patch.closeReviewsOnNewerBuild !== undefined) {
    set.closeReviewsOnNewerBuild = patch.closeReviewsOnNewerBuild
  }
  if (patch.reRequestOnNewerBuild !== undefined) {
    set.reRequestOnNewerBuild = patch.reRequestOnNewerBuild
  }
  if (patch.autoApproveNoChanges !== undefined)
    set.autoApproveNoChanges = patch.autoApproveNoChanges
  if (patch.requireRejectReason !== undefined) set.requireRejectReason = patch.requireRejectReason
  if (patch.autoApproveDefaultBranch !== undefined) {
    set.autoApproveDefaultBranch = patch.autoApproveDefaultBranch
  }
  if (patch.blockMergeOnChanges !== undefined) set.blockMergeOnChanges = patch.blockMergeOnChanges
  if (patch.flakyBlocksMerge !== undefined) set.flakyBlocksMerge = patch.flakyBlocksMerge
  if (patch.staticHostingEnabled !== undefined)
    set.staticHostingEnabled = patch.staticHostingEnabled
  if (Object.keys(set).length === 0) {
    const current = await getTeamById(db, teamId)
    assertFound(current, 'Team not found')
    return teamSettings(current)
  }
  try {
    const [row] = await db.update(teams).set(set).where(eq(teams.id, teamId)).returning()
    assertFound(row, 'Team not found')
    return teamSettings(row)
  } catch (err) {
    // `teams_workspace_slug_key`: another team in the workspace already has this slug.
    if (isUniqueViolation(err))
      throw new ConflictError(`The address "${set.slug}" is already taken`)
    throw err
  }
}

/**
 * Deletes a team; its builds, snapshots, sites, rules, links and webhooks go with it through the
 * schema's cascades. Files are content-addressed and shared, so they stay: retention marks and
 * collects the ones nothing points at any more. Returns the team's CI key id (to revoke it).
 */
export async function deleteTeam(db: Database, teamId: string): Promise<string | null> {
  const [row] = await db.delete(teams).where(eq(teams.id, teamId)).returning({ key: teams.ciKeyId })
  assertFound(row, 'Team not found')
  return row.key
}
