import { assertValidSlug, issueProjectToken, slugify, ValidationError } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '../errors.ts'
import { organizations, projects } from '../schema/index.ts'
import type { Project } from '../types.ts'
import { getOrganizationBySlug } from './organizations.ts'

/** Projects and their CI tokens, and the lookups the API and dashboard need. */

export interface CreatedProject {
  project: Project
  /** The CI token, shown exactly once. Only its hash is stored. */
  token: string
}

export async function createProject(
  db: Database,
  input: { orgSlug: string; name: string; slug?: string; defaultBranch?: string },
): Promise<CreatedProject> {
  const org = await getOrganizationBySlug(db, input.orgSlug)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Project name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'project slug')
  const defaultBranch = input.defaultBranch?.trim() || 'main'
  const issued = issueProjectToken()
  try {
    const [project] = await db
      .insert(projects)
      .values({
        orgId: org.id,
        name,
        slug,
        defaultBranch,
        tokenHash: issued.hash,
        tokenHint: issued.hint,
      })
      .returning()
    if (!project) throw new Error('insert returned no row')
    return { project, token: issued.token }
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

/** Replaces the CI token. The old token stops working immediately. */
export async function rotateProjectToken(
  db: Database,
  input: { orgSlug: string; projectSlug: string },
): Promise<CreatedProject> {
  const org = await getOrganizationBySlug(db, input.orgSlug)
  const issued = issueProjectToken()
  const [project] = await db
    .update(projects)
    .set({ tokenHash: issued.hash, tokenHint: issued.hint, tokenCreatedAt: new Date() })
    .where(and(eq(projects.orgId, org.id), eq(projects.slug, input.projectSlug)))
    .returning()
  if (!project) throw new NotFoundError(`Project "${input.orgSlug}/${input.projectSlug}" not found`)
  return { project, token: issued.token }
}

export async function findProjectByTokenHash(
  db: Database,
  tokenHash: string,
): Promise<Project | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.tokenHash, tokenHash))
  return row
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
    .select({ project: projects, orgSlug: organizations.slug })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(eq(projects.id, projectId))
  return row
}

export async function findProjectBySlugs(
  db: Database,
  orgSlug: string,
  projectSlug: string,
): Promise<
  | {
      id: string
      slug: string
      name: string
      defaultBranch: string
      orgSlug: string
      orgName: string
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      defaultBranch: projects.defaultBranch,
      orgSlug: organizations.slug,
      orgName: organizations.name,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)))
  return row
}
