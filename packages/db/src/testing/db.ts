import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { inject } from 'vitest'

import { createProject } from '#repositories/index.ts'
import * as schema from '#schema/index.ts'
import { createDb, type Database, type ListenFn, type Workspace, type User } from '#src/index.ts'

import { nextCreatedAt } from './created-at.ts'
import {
  cloneTemplate,
  databaseUrl,
  dropDatabase,
  prepareTestServer,
  TEST_DATABASE_PREFIX,
  type TestServer,
} from './server.ts'

// The server and template that template-db.ts (the run's global setup) provides. Declared here,
// beside the `inject` that reads it, so every package whose tests use this file sees it.
declare module 'vitest' {
  export interface ProvidedContext {
    testServer: TestServer
  }
}

export namespace createTestDb {
  export interface Result {
    /** The database's connection pool, for a test that runs SQL of its own. */
    client: Pool
    db: Database
    /** LISTEN on a dedicated connection, as in production (`createDb`). */
    listen: ListenFn
    /** Closes the connections and drops the database. */
    close(): Promise<void>
    /** The statements the Drizzle `db` has run since `queries.reset()` (a transaction's BEGIN and COMMIT are not counted). */
    queries: { count(): number; sql(): string[]; reset(): void }
    /** Empties every table the app owns (not the migration history), for a file that wants a clean slate per test. */
    reset(): Promise<void>
  }
}

let server: Promise<TestServer> | undefined

/** The run's server and template, or, for a file run without the global setup, prepared here. */
function testServer(): Promise<TestServer> {
  server ??= (async () => {
    try {
      const provided = inject('testServer')
      if (provided) return provided
    } catch {
      // Not under Vitest's global setup.
    }
    return prepareTestServer()
  })()
  return server
}

let created = 0

/**
 * A database of its own on the test Postgres server, with every migration applied: a copy of the
 * migrated template the global setup made (server.ts). It uses production's connection code
 * (`createDb`: a pool, and LISTEN on a dedicated connection). Close it when the file is done
 * (`afterAll(() => t.close())`): that drops it. `empty` gives a database with no tables at all, as
 * a server is before its first migration.
 */
export async function createTestDb({
  empty = false,
}: { empty?: boolean } = {}): Promise<createTestDb.Result> {
  const target = await testServer()
  created += 1
  const name = `${TEST_DATABASE_PREFIX}${process.pid}_${created}_${randomBytes(3).toString('hex')}`
  await cloneTemplate(target, name, empty)
  const handle = createDb({
    url: databaseUrl(target.url, name),
    poolMax: 4,
    applicationName: 'circi-test',
  })
  let log: string[] = []
  const db = drizzle({
    client: handle.pool,
    schema,
    logger: { logQuery: (query) => void log.push(query) },
  })
  const queries = { count: () => log.length, sql: () => [...log], reset: () => void (log = []) }
  const reset = async () => {
    const { rows } = await handle.pool.query<{ name: string }>(
      `select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'`,
    )
    if (rows.length === 0) return
    await handle.pool.query(
      `truncate ${rows.map((r) => r.name).join(', ')} restart identity cascade`,
    )
  }
  const close = async () => {
    await handle.close()
    await dropDatabase(target.url, name)
  }
  return { client: handle.pool, db, listen: handle.listen, close, queries, reset }
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

/**
 * A new user who is a member of the workspace (`seedUser` and `addTestMember` in one): a member
 * of every project it has now, with a unique email unless one is given. Pass `{ role, projects }`
 * for what `addTestMember` takes.
 */
export async function seedMember(
  db: Database,
  workspaceId: string,
  options:
    | string
    | { email?: string; role?: 'owner' | 'admin' | 'member'; projects?: string[] } = {},
): Promise<User> {
  const { email, ...rest } = typeof options === 'string' ? { email: options } : options
  const user = await seedUser(db, email)
  await addTestMember(db, { workspaceId, userId: user.id, ...rest })
  return user
}

/**
 * Adds a user to a workspace. They join every
 * project the workspace has now (pass `projects: []` to join none, or the project ids to join only
 * those); a project made later has to be joined on purpose.
 */
export async function addTestMember(
  db: Database,
  input: {
    workspaceId: string
    userId: string
    role?: 'owner' | 'admin' | 'member'
    projects?: string[]
  },
): Promise<void> {
  n += 1
  await db.insert(schema.member).values({
    id: `member-${n}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role ?? 'member',
    createdAt: nextCreatedAt(),
  })
  const projectIds =
    input.projects ??
    (
      await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.workspaceId, input.workspaceId))
    ).map((t) => t.id)
  if (projectIds.length > 0) {
    await db
      .insert(schema.projectMembers)
      .values(projectIds.map((projectId) => ({ projectId, userId: input.userId })))
      .onConflictDoNothing()
  }
}

/** Puts a user in a project (they must already belong to its workspace). */
export async function addTestProjectMember(
  db: Database,
  input: { projectId: string; userId: string },
): Promise<void> {
  await db
    .insert(schema.projectMembers)
    .values({ projectId: input.projectId, userId: input.userId })
    .onConflictDoNothing()
}

/** A new workspace (with an owner) and a project in it. */
export async function seedProject(
  db: Database,
  options: { defaultBranch?: string; slug?: string; workspace?: seedWorkspace.Result } = {},
) {
  const seeded = options.workspace ?? (await seedWorkspace(db))
  const project = await createProject(db, {
    workspaceSlug: seeded.workspace.slug,
    name: options.slug ?? 'web',
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
  })
  // Everyone already in the workspace is in the new project too, so a test that adds members and
  // then reads as one of them sees the project (a test of hiding adds the members after, or removes them).
  const existing = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.workspaceId, seeded.workspace.id))
  if (existing.length > 0) {
    await db
      .insert(schema.projectMembers)
      .values(existing.map((m) => ({ projectId: project.id, userId: m.userId })))
      .onConflictDoNothing()
  }
  return { project, workspace: seeded.workspace, owner: seeded.owner }
}
