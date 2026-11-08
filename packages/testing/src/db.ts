import {
  createTeam,
  type Database,
  type ListenFn,
  migrationsFolder,
  type Workspace,
  schema,
  type User,
} from '@circi/db'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

export namespace createTestDb {
  export interface Result {
    client: PGlite
    db: Database
    /** PGlite's LISTEN, shaped like the production `ListenFn`. */
    listen: ListenFn
    close(): Promise<void>
  }
}

/** A fresh in-process Postgres (PGlite) with every migration applied. */
export async function createTestDb(): Promise<createTestDb.Result> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder })
  const listen: ListenFn = async (channel, onNotify) => {
    const unsubscribe = await client.listen(channel, onNotify)
    return async () => {
      await unsubscribe()
    }
  }
  return { client, db, listen, close: () => client.close() }
}

let n = 0

export namespace seedWorkspace {
  export interface Result {
    workspace: Workspace
    owner: User
  }
}

/**
 * Inserts a user, a workspace and an owner membership directly. Production code creates
 * these through better-auth (`@circi/auth`); the db package can't depend on it, and its tests
 * only need rows that look the way better-auth leaves them.
 */
export async function seedWorkspace(db: Database): Promise<seedWorkspace.Result> {
  n += 1
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .insert(schema.user)
      .values({ id: `user-${n}`, name: `Owner ${n}`, email: `owner${n}@example.com` })
      .returning()
    const [workspace] = await tx
      .insert(schema.workspace)
      .values({
        id: `workspace-${n}`,
        name: `Workspace ${n}`,
        slug: `workspace-${n}`,
        createdAt: new Date(),
      })
      .returning()
    if (!owner || !workspace) throw new Error('seed insert returned no row')
    await tx.insert(schema.member).values({
      id: `member-${n}`,
      workspaceId: workspace.id,
      userId: owner.id,
      role: 'owner',
      createdAt: new Date(),
    })
    return { workspace, owner }
  })
}

/** A user who belongs to no workspace yet. */
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
  input: { workspaceId: string; userId: string; role?: 'owner' | 'admin' | 'member' },
): Promise<void> {
  n += 1
  await db.insert(schema.member).values({
    id: `member-${n}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role ?? 'member',
    createdAt: new Date(),
  })
}

/** A new workspace (with an owner) and a team in it. */
export async function seedTeam(
  db: Database,
  options: { defaultBranch?: string; slug?: string; workspace?: seedWorkspace.Result } = {},
) {
  const seeded = options.workspace ?? (await seedWorkspace(db))
  const team = await createTeam(db, {
    workspaceSlug: seeded.workspace.slug,
    name: options.slug ?? 'web',
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
  })
  return { team, workspace: seeded.workspace, owner: seeded.owner }
}

/** A fake sha256 made of one repeated hex digit. */
export const sha = (c: string) => c.repeat(64).slice(0, 64)
