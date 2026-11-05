import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import {
  createProject,
  type Database,
  migrationsFolder,
  type Organization,
  schema,
  type User,
} from '../src/index.ts'

export interface TestDb {
  client: PGlite
  db: Database
  close(): Promise<void>
}

/** A fresh in-process Postgres (PGlite) with every migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder })
  return { client, db, close: () => client.close() }
}

let n = 0

export interface SeededOrg {
  org: Organization
  owner: User
}

/**
 * Inserts a user, an organization and an owner membership directly. Production code creates
 * these through better-auth (`@circi/auth`); the db package can't depend on it, and its tests
 * only need rows that look the way better-auth leaves them.
 */
export async function seedOrg(db: Database): Promise<SeededOrg> {
  n += 1
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .insert(schema.user)
      .values({ id: `user-${n}`, name: `Owner ${n}`, email: `owner${n}@example.com` })
      .returning()
    const [org] = await tx
      .insert(schema.organization)
      .values({ id: `org-${n}`, name: `Org ${n}`, slug: `org-${n}`, createdAt: new Date() })
      .returning()
    if (!owner || !org) throw new Error('seed insert returned no row')
    await tx.insert(schema.member).values({
      id: `member-${n}`,
      organizationId: org.id,
      userId: owner.id,
      role: 'owner',
      createdAt: new Date(),
    })
    return { org, owner }
  })
}

/** A user who belongs to no organization yet. */
export async function seedUser(db: Database, email?: string): Promise<User> {
  n += 1
  const [user] = await db
    .insert(schema.user)
    .values({ id: `user-${n}`, name: `User ${n}`, email: email ?? `user${n}@example.com` })
    .returning()
  if (!user) throw new Error('seed insert returned no row')
  return user
}

export async function addTestMember(
  db: Database,
  input: { orgId: string; userId: string; role?: 'owner' | 'admin' | 'member' },
): Promise<void> {
  n += 1
  await db.insert(schema.member).values({
    id: `member-${n}`,
    organizationId: input.orgId,
    userId: input.userId,
    role: input.role ?? 'member',
    createdAt: new Date(),
  })
}

/** A new organization (with an owner) and a project in it. */
export async function seedProject(
  db: Database,
  options: { defaultBranch?: string; slug?: string; org?: SeededOrg } = {},
) {
  const seeded = options.org ?? (await seedOrg(db))
  const project = await createProject(db, {
    orgSlug: seeded.org.slug,
    name: options.slug ?? 'web',
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
  })
  return { project, org: seeded.org, owner: seeded.owner }
}

/** A fake sha256 made of one repeated hex digit. */
export const sha = (c: string) => c.repeat(64).slice(0, 64)
