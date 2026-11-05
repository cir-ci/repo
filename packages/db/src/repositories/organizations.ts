import { and, asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { NotFoundError } from '../errors.ts'
import { member, organization } from '../schema/index.ts'
import type { Organization } from '../types.ts'

/**
 * Read access to organizations and memberships. They're owned by better-auth's organization
 * plugin: create orgs and add members through `@circi/auth`, never by writing these tables.
 */

export async function listOrganizations(db: Database): Promise<Organization[]> {
  return db.select().from(organization).orderBy(asc(organization.slug))
}

export async function getOrganizationBySlug(db: Database, slug: string): Promise<Organization> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, slug))
  if (!org) throw new NotFoundError(`Organization "${slug}" not found`)
  return org
}

/** The organizations a user belongs to: the boundary of everything they may see (PLAN §8). */
export async function listUserOrganizationIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
  return rows.map((r) => r.id)
}

/**
 * A user who owns the organization. better-auth only lets owners issue organization-owned API
 * keys, so CI tokens are issued on behalf of one.
 */
export async function findOrganizationOwnerId(
  db: Database,
  organizationId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  return row?.userId
}

/** The user's role in an organization, or undefined when they aren't a member. */
export async function getMemberRole(
  db: Database,
  input: { userId: string; organizationId: string },
): Promise<string | undefined> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, input.userId), eq(member.organizationId, input.organizationId)))
  return row?.role
}

/** Organizations where the user is an owner or admin, i.e. may create projects. */
export async function listManageableOrganizations(
  db: Database,
  userId: string,
): Promise<{ slug: string; name: string }[]> {
  return db
    .select({ slug: organization.slug, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), inArray(member.role, ['owner', 'admin'])))
    .orderBy(asc(organization.slug))
}
