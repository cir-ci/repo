import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '../errors.ts'
import { member, organization, projects } from '../schema/index.ts'
import type { Project } from '../types.ts'
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
  input: { orgSlug: string; projectSlug: string; userId: string },
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
    .where(and(eq(organization.slug, input.orgSlug), eq(projects.slug, input.projectSlug)))
  return row
}
