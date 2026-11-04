import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import { asc, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '../errors.ts'
import { organizations } from '../schema/index.ts'
import type { Organization } from '../types.ts'

/** Organizations: create, list, look up. */

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
