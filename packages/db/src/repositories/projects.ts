import {
  assertBranchName,
  assertDiffThreshold,
  assertFlakyAfterChanges,
  assertSnoozeDefaultDays,
  assertRetentionDays,
  assertReviewTargetHours,
  assertProjectColor,
  assertProjectIcon,
  assertValidSlug,
  slugify,
  projectColorFor,
  type ProjectColor,
  ValidationError,
  assertFound,
} from '@circi/core'
import { and, eq } from 'drizzle-orm'

import { getProjectById, projectSettings } from '#queries/project-lookup.ts'
import { getWorkspaceSettings } from '#queries/workspace-settings.ts'
import { getWorkspaceBySlug } from '#queries/workspaces.ts'
import { projectMembers, projects } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'
import type { Project } from '#src/types.ts'

import { addProjectMembers } from './project-members.ts'
import { refreshTriageProblems } from './triage-problems.ts'

/**
 * Projects, and the lookups the API and dashboard need. A project's CI token is a better-auth
 * API key (`ci_key_id`); issuing and rotating it happens in `@circi/auth`.
 */

export async function createProject(
  db: Database,
  input: {
    workspaceSlug: string
    name: string
    slug?: string
    defaultBranch?: string
    /** A palette colour; from a hash of the name when left out. */
    color?: string
    /** A Lucide icon name from `PROJECT_ICON_NAMES`; none shows only the marble. */
    icon?: string | null
    /** Added to the project: the person creating it. */
    createdBy?: string
    /** Added to the project too; each must belong to the workspace. */
    memberIds?: string[]
  },
): Promise<Project> {
  const found = await getWorkspaceBySlug(db, input.workspaceSlug)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Project name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'project slug')
  const defaultBranch = input.defaultBranch?.trim() || 'main'
  assertBranchName(defaultBranch)
  const color = input.color ?? projectColorFor(name)
  assertProjectColor(color)
  const icon = input.icon ?? null
  if (icon !== null) assertProjectIcon(icon)
  // A new project starts with the workspace's default retention; it can change its own after.
  const { retentionDays } = await getWorkspaceSettings(db, found.id)
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ workspaceId: found.id, name, slug, defaultBranch, color, icon, retentionDays })
        .returning()
      if (!project) throw new Error('insert returned no row')
      const first = input.createdBy === undefined ? [] : [input.createdBy]
      await addProjectMembers(tx, {
        projectId: project.id,
        userIds: [...first, ...(input.memberIds ?? [])],
        addedBy: input.createdBy ?? null,
      })
      return project
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`Project "${input.workspaceSlug}/${slug}" already exists`)
    }
    throw err
  }
}

export namespace setProjectAppearance {
  export interface Appearance {
    color: ProjectColor
    icon: string | null
  }
}

/** Changes the project's tile colour and/or icon (`null` clears the icon); invalid values are a `ValidationError`. */
export async function setProjectAppearance(
  db: Database,
  projectId: string,
  patch: { color?: string; icon?: string | null },
): Promise<setProjectAppearance.Appearance> {
  const set: { color?: ProjectColor; icon?: string | null } = {}
  if (patch.color !== undefined) {
    assertProjectColor(patch.color)
    set.color = patch.color
  }
  if (patch.icon !== undefined) {
    if (patch.icon !== null) assertProjectIcon(patch.icon)
    set.icon = patch.icon
  }
  if (Object.keys(set).length === 0) {
    const current = await getProjectById(db, projectId)
    assertFound(current, 'Project not found')
    return { color: current.color, icon: current.icon }
  }
  const [row] = await db.update(projects).set(set).where(eq(projects.id, projectId)).returning()
  assertFound(row, 'Project not found')
  return { color: row.color, icon: row.icon }
}

/** Points the project at its current CI key (null after revoking). */
export async function setProjectCiKey(
  db: Database,
  projectId: string,
  ciKeyId: string | null,
  createdBy: string | null = null,
): Promise<void> {
  await db
    .update(projects)
    .set({ ciKeyId, ciKeyCreatedBy: createdBy })
    .where(eq(projects.id, projectId))
}

/**
 * Changes the given settings only; invalid values are a `ValidationError`. A new slug must be
 * valid and free in the workspace (`ConflictError`); like a workspace's address, the old one
 * stops working (there is no redirect).
 */
export async function updateProjectSettings(
  db: Database,
  projectId: string,
  patch: Partial<projectSettings.Settings>,
  addedFlaky?: string[],
): Promise<projectSettings.Settings> {
  const set: Partial<projectSettings.Settings> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new ValidationError('Project name is required')
    set.name = name
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim()
    assertValidSlug(slug, 'project slug')
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
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, patch.reviewOverdueNotifyUserId),
          ),
        )
      if (!row) {
        throw new ValidationError('Choose a member of this project', {
          fields: { reviewOverdueNotifyUserId: 'Choose a member of this project' },
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
  if (patch.assignTriageToOnCall !== undefined) {
    set.assignTriageToOnCall = patch.assignTriageToOnCall
  }
  if (patch.staticHostingEnabled !== undefined)
    set.staticHostingEnabled = patch.staticHostingEnabled
  if (Object.keys(set).length === 0) {
    const current = await getProjectById(db, projectId)
    assertFound(current, 'Project not found')
    return projectSettings(current)
  }
  try {
    const [row] = await db.update(projects).set(set).where(eq(projects.id, projectId)).returning()
    assertFound(row, 'Project not found')
    // The queue's problems follow the default branch and the flaky threshold.
    if (set.defaultBranch !== undefined || set.flakyAfterChanges !== undefined) {
      const added = await refreshTriageProblems(db, projectId)
      addedFlaky?.push(...added)
    }
    return projectSettings(row)
  } catch (err) {
    // `projects_workspace_slug_key`: another project in the workspace already has this slug.
    if (isUniqueViolation(err))
      throw new ConflictError(`The address "${set.slug}" is already taken`)
    throw err
  }
}

/**
 * Deletes a project; its builds, snapshots, sites, rules, links and webhooks go with it through the
 * schema's cascades. Files are content-addressed and shared, so they stay: retention marks and
 * collects the ones nothing points at any more. Returns the project's CI key id (to revoke it).
 */
export async function deleteProject(db: Database, projectId: string): Promise<string | null> {
  const [row] = await db
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning({ key: projects.ciKeyId })
  assertFound(row, 'Project not found')
  return row.key
}
