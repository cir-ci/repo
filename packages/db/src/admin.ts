import { assertValidSlug, issueProjectToken, slugify, ValidationError } from '@zopheros/core'
import { and, asc, eq } from 'drizzle-orm'

import type { Database } from './client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from './errors.ts'
import { organizations, projects } from './schema.ts'

export type Organization = typeof organizations.$inferSelect
export type Project = typeof projects.$inferSelect

export async function createOrganization(
  db: Database,
  input: { name: string; slug?: string },
): Promise<Organization> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Organization name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'organization slug')
  try {
    const [org] = await db.insert(organizations).values({ name, slug }).returning()
    if (!org) throw new Error('insert returned no row')
    return org
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`Organization "${slug}" already exists`)
    throw err
  }
}

export async function listOrganizations(db: Database): Promise<Organization[]> {
  return db.select().from(organizations).orderBy(asc(organizations.slug))
}

export async function getOrganizationBySlug(db: Database, slug: string): Promise<Organization> {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug))
  if (!org) throw new NotFoundError(`Organization "${slug}" not found`)
  return org
}

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
