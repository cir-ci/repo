import { readFile } from 'node:fs/promises'

import {
  type Database,
  type ListenFn,
  migrationsFolder,
  type Workspace,
  type User,
} from '@circi/db'
import { createTeam } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { inject } from 'vitest'

import { nextCreatedAt } from './created-at.ts'

export namespace createTestDb {
  export interface Result {
    client: PGlite
    db: Database
    /** PGlite's LISTEN, shaped like the production `ListenFn`. */
    listen: ListenFn
    close(): Promise<void>
    /** Empties every table the app owns (not the migration history), for a file that wants a clean slate per test. */
    reset(): Promise<void>
  }
}

let template: Promise<Blob | null> | undefined

/** The migrated database the global setup dumped, or null when it did not run (a lone file). */
function loadTemplate(): Promise<Blob | null> {
  template ??= (async () => {
    try {
      const path = inject('templateDump')
      return path ? new Blob([await readFile(path)]) : null
    } catch {
      return null
    }
  })()
  return template
}

/**
 * A fresh in-process Postgres (PGlite) with every migration applied: restored from the dump
 * the global setup made once, or migrated here when there is none.
 */
export async function createTestDb(): Promise<createTestDb.Result> {
  const dump = await loadTemplate()
  const client = dump ? new PGlite({ loadDataDir: dump }) : new PGlite()
  const db = drizzle({ client, schema })
  if (!dump) await migrate(db, { migrationsFolder })
  const listen: ListenFn = async (channel, onNotify) => {
    const unsubscribe = await client.listen(channel, onNotify)
    return async () => {
      await unsubscribe()
    }
  }
  const reset = async () => {
    const { rows } = await client.query<{ name: string }>(
      `select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'`,
    )
    if (rows.length === 0) return
    await client.exec(`truncate ${rows.map((r) => r.name).join(', ')} restart identity cascade`)
  }
  return { client, db, listen, close: () => client.close(), reset }
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
        createdAt: nextCreatedAt(),
      })
      .returning()
    if (!owner || !workspace) throw new Error('seed insert returned no row')
    await tx.insert(schema.member).values({
      id: `member-${n}`,
      workspaceId: workspace.id,
      userId: owner.id,
      role: 'owner',
      createdAt: nextCreatedAt(),
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
    createdAt: nextCreatedAt(),
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
