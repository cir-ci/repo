import {
  assertTeamColor,
  assertTeamIcon,
  assertValidSlug,
  slugify,
  teamColorFor,
  type TeamColor,
  ValidationError,
  assertFound,
} from '@circi/core'
import { eq } from 'drizzle-orm'

import { getTeamById, teamSettings } from '#queries/team-lookup.ts'
import { getWorkspaceSettings } from '#queries/workspace-settings.ts'
import { getWorkspaceBySlug } from '#queries/workspaces.ts'
import { teams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'
import type { Team } from '#src/types.ts'

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
    /** A Lucide icon name from `TEAM_ICON_NAMES`; none shows the first letter. */
    icon?: string | null
  },
): Promise<Team> {
  const found = await getWorkspaceBySlug(db, input.workspaceSlug)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Team name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'team slug')
  const defaultBranch = input.defaultBranch?.trim() || 'main'
  const color = input.color ?? teamColorFor(name)
  assertTeamColor(color)
  const icon = input.icon ?? null
  if (icon !== null) assertTeamIcon(icon)
  // A new team starts with the workspace's default retention; it can change its own after.
  const { retentionDays } = await getWorkspaceSettings(db, found.id)
  try {
    const [team] = await db
      .insert(teams)
      .values({ workspaceId: found.id, name, slug, defaultBranch, color, icon, retentionDays })
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
