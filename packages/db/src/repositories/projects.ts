import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '../errors.ts'
import { member, organization, projects } from '../schema/index.ts'
import type { Project } from '../types.ts'
import { orgAccepts, type SessionMethod } from './auth-settings.ts'
import { getOrganizationBySlug } from './organizations.ts'

/**
 * Projects, and the lookups the API and dashboard need. A project's CI token is a better-auth
 * API key (`ci_key_id`); issuing and rotating it happens in `@circi/auth`.
 */

export async function createProject(
  db: Database,
  input: { orgSlug: string; name: string; slug?: string; defaultBranch?: string },
): Promise<Project> {
  const org = await getOrganizationBySlug(db, input.orgSlug)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Project name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'project slug')
  const defaultBranch = input.defaultBranch?.trim() || 'main'
  try {
    const [project] = await db
      .insert(projects)
      .values({ orgId: org.id, name, slug, defaultBranch })
      .returning()
    if (!project) throw new Error('insert returned no row')
    return project
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`Project "${input.orgSlug}/${slug}" already exists`)
    }
    throw err
  }
}

export async function listProjects(db: Database, orgSlug: string): Promise<Project[]> {
  const org = await getOrganizationBySlug(db, orgSlug)
  return db.select().from(projects).where(eq(projects.orgId, org.id)).orderBy(asc(projects.slug))
}

export async function getProjectBySlugs(
  db: Database,
  input: { orgSlug: string; projectSlug: string },
): Promise<Project> {
  const [row] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .where(and(eq(organization.slug, input.orgSlug), eq(projects.slug, input.projectSlug)))
  if (!row) throw new NotFoundError(`Project "${input.orgSlug}/${input.projectSlug}" not found`)
  return row.project
}

/** Points the project at its current CI key (null after revoking). */
export async function setProjectCiKey(
  db: Database,
  projectId: string,
  ciKeyId: string | null,
): Promise<void> {
  await db.update(projects).set({ ciKeyId }).where(eq(projects.id, projectId))
}

export async function getProjectById(
  db: Database,
  projectId: string,
): Promise<Project | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  return row
}

export interface ProjectContext {
  project: Project
  orgSlug: string
}

/** A project plus its org slug, which dashboard URLs need. */
export async function getProjectContext(
  db: Database,
  projectId: string,
): Promise<ProjectContext | undefined> {
  const [row] = await db
    .select({ project: projects, orgSlug: organization.slug })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .where(eq(projects.id, projectId))
  return row
}

export interface VisibleProject {
  id: string
  slug: string
  name: string
  defaultBranch: string
  orgSlug: string
  orgName: string
}

/**
 * A project by its URL slugs, only if `userId` is a member of its organization. Anyone else
 * gets the same "not found" as for a project that doesn't exist (PLAN §8: org isolation).
 */
export async function findProjectForMember(
  db: Database,
  input: { orgSlug: string; projectSlug: string; userId: string; method?: SessionMethod },
): Promise<VisibleProject | undefined> {
  const [row] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      defaultBranch: projects.defaultBranch,
      orgSlug: organization.slug,
      orgName: organization.name,
    })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, input.userId)),
    )
    .where(
      and(
        eq(organization.slug, input.orgSlug),
        eq(projects.slug, input.projectSlug),
        orgAccepts(organization.id, input.method),
      ),
    )
  return row
}

/** The member's role in the project's organization (`owner`, `admin`, `member`), if they belong. */
export async function getProjectMemberRole(
  db: Database,
  projectId: string,
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ role: member.role })
    .from(projects)
    .innerJoin(member, and(eq(member.organizationId, projects.orgId), eq(member.userId, userId)))
    .where(eq(projects.id, projectId))
  return row?.role
}

export interface ProjectSettings {
  name: string
  defaultBranch: string
  diffThreshold: number
  autoApproveDefaultBranch: boolean
  blockMergeOnChanges: boolean
  /** Whether flaky-only changes block the merge; null inherits the organization's setting. */
  flakyBlocksMerge: boolean | null
  retentionDays: number
  /** Whether CI may upload static sites for this project (needs `STATIC_SITES_HOST`). */
  staticHostingEnabled: boolean
}

export function projectSettings(project: Project): ProjectSettings {
  return {
    name: project.name,
    defaultBranch: project.defaultBranch,
    diffThreshold: project.diffThreshold,
    autoApproveDefaultBranch: project.autoApproveDefaultBranch,
    blockMergeOnChanges: project.blockMergeOnChanges,
    flakyBlocksMerge: project.flakyBlocksMerge,
    retentionDays: project.retentionDays,
    staticHostingEnabled: project.staticHostingEnabled,
  }
}

/** Changes the given settings only; invalid values are a `ValidationError`. */
export async function updateProjectSettings(
  db: Database,
  projectId: string,
  patch: Partial<ProjectSettings>,
): Promise<ProjectSettings> {
  const set: Partial<ProjectSettings> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new ValidationError('Project name is required')
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
  if (patch.autoApproveDefaultBranch !== undefined) {
    set.autoApproveDefaultBranch = patch.autoApproveDefaultBranch
  }
  if (patch.blockMergeOnChanges !== undefined) set.blockMergeOnChanges = patch.blockMergeOnChanges
  if (patch.flakyBlocksMerge !== undefined) set.flakyBlocksMerge = patch.flakyBlocksMerge
  if (patch.staticHostingEnabled !== undefined)
    set.staticHostingEnabled = patch.staticHostingEnabled
  if (Object.keys(set).length === 0) {
    const current = await getProjectById(db, projectId)
    if (!current) throw new NotFoundError('Project not found')
    return projectSettings(current)
  }
  const [row] = await db.update(projects).set(set).where(eq(projects.id, projectId)).returning()
  if (!row) throw new NotFoundError('Project not found')
  return projectSettings(row)
}
