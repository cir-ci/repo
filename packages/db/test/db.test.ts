import { hashToken } from '@circi/core'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ConflictError,
  createOrganization,
  createProject,
  type Database,
  listOrganizations,
  listProjects,
  migrationsFolder,
  NotFoundError,
  pgErrorCode,
  rotateProjectToken,
  schema,
} from '../src/index.ts'

let client: PGlite
let db: Database

beforeAll(async () => {
  client = new PGlite()
  const pglite = drizzle({ client, schema })
  await migrate(pglite, { migrationsFolder })
  db = pglite
})

afterAll(async () => {
  await client.close()
})

/** Run a statement that must fail, and return its Postgres error code. */
async function failCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
  } catch (err) {
    return pgErrorCode(err)
  }
  throw new Error('expected the statement to fail')
}

describe('migrations', () => {
  it('create every M0/M1 table', async () => {
    const res = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    )
    expect(res.rows.map((r) => r.tablename)).toEqual([
      'build_shards',
      'builds',
      'commit_ancestry',
      'files',
      'memberships',
      'organizations',
      'projects',
      'reviews',
      'screenshot_diffs',
      'screenshots',
      'upload_claims',
      'users',
    ])
  })

  it('are idempotent', async () => {
    await expect(
      migrate(drizzle({ client, schema }), { migrationsFolder }),
    ).resolves.toBeUndefined()
  })
})

describe('organizations and projects', () => {
  it('creates an org with a derived slug and rejects duplicates', async () => {
    const org = await createOrganization(db, { name: 'Acme Inc' })
    expect(org.slug).toBe('acme-inc')
    await expect(createOrganization(db, { name: 'Acme Inc' })).rejects.toBeInstanceOf(ConflictError)
    expect((await listOrganizations(db)).map((o) => o.slug)).toContain('acme-inc')
  })

  it('creates a project whose token is stored only as a hash', async () => {
    await createOrganization(db, { name: 'Tokens', slug: 'tokens' })
    const { project, token } = await createProject(db, { orgSlug: 'tokens', name: 'Web app' })
    expect(project.slug).toBe('web-app')
    expect(project.defaultBranch).toBe('main')
    expect(project.tokenHash).toBe(hashToken(token))
    expect(project.tokenHint).toBe(`${token.slice(0, 12)}…`)
    const raw = await client.query(`select * from projects where id = $1`, [project.id])
    expect(JSON.stringify(raw.rows)).not.toContain(token)
  })

  it('applies the plan defaults to new projects', async () => {
    await createOrganization(db, { name: 'Defaults', slug: 'defaults' })
    const { project } = await createProject(db, { orgSlug: 'defaults', name: 'p' })
    expect(project).toMatchObject({
      diffThreshold: 0,
      autoApproveDefaultBranch: true,
      blockMergeOnChanges: true,
      retentionDays: 30,
      staticHostingEnabled: false,
      buildCounter: 0,
    })
  })

  it('scopes project slugs per org', async () => {
    await createOrganization(db, { name: 'One', slug: 'one' })
    await createOrganization(db, { name: 'Two', slug: 'two' })
    await createProject(db, { orgSlug: 'one', name: 'web' })
    await createProject(db, { orgSlug: 'two', name: 'web' })
    await expect(createProject(db, { orgSlug: 'one', name: 'web' })).rejects.toBeInstanceOf(
      ConflictError,
    )
    await expect(createProject(db, { orgSlug: 'missing', name: 'web' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('rotates only the requested project token', async () => {
    await createOrganization(db, { name: 'Rotate', slug: 'rotate' })
    const a = await createProject(db, { orgSlug: 'rotate', name: 'a' })
    const b = await createProject(db, { orgSlug: 'rotate', name: 'b' })
    const rotated = await rotateProjectToken(db, { orgSlug: 'rotate', projectSlug: 'a' })
    expect(rotated.token).not.toBe(a.token)
    const projects = await listProjects(db, 'rotate')
    const byslug = Object.fromEntries(projects.map((p) => [p.slug, p]))
    expect(byslug.a?.tokenHash).toBe(hashToken(rotated.token))
    expect(byslug.b?.tokenHash).toBe(hashToken(b.token))
    await expect(
      rotateProjectToken(db, { orgSlug: 'rotate', projectSlug: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

/** A fake sha256 made of one repeated hex digit. */
const h = (c: string) => c.repeat(64)

describe('schema constraints from the plan', () => {
  it('only accepts lowercase hex sha256 file ids', async () => {
    const code = await failCode(() =>
      db.insert(schema.files).values({ sha256: 'ABC', storageKey: 'k1', kind: 'screenshot' }),
    )
    expect(code).toBe('23514')
  })

  it('keeps status and verified_at consistent', async () => {
    const code = await failCode(() =>
      db
        .insert(schema.files)
        .values({ sha256: h('a'), storageKey: 'k2', kind: 'screenshot', status: 'verified' }),
    )
    expect(code).toBe('23514')
    await db.insert(schema.files).values({
      sha256: h('a'),
      storageKey: 'k2',
      kind: 'screenshot',
      status: 'verified',
      verifiedAt: new Date(),
    })
  })

  it('collapses concurrent shards into one build per (project, name, commit, nonce)', async () => {
    await createOrganization(db, { name: 'Shards', slug: 'shards' })
    const { project } = await createProject(db, { orgSlug: 'shards', name: 'p' })
    const build = {
      projectId: project.id,
      commitSha: 'c0ffee',
      parallelNonce: 'run-1',
      parallelTotal: 3,
    }
    const inserted = await Promise.all(
      [1, 2, 3].map((n) =>
        db
          .insert(schema.builds)
          .values({ ...build, number: n })
          .onConflictDoNothing({
            target: [
              schema.builds.projectId,
              schema.builds.name,
              schema.builds.commitSha,
              schema.builds.parallelNonce,
            ],
            where: sql`${schema.builds.parallelNonce} is not null`,
          })
          .returning(),
      ),
    )
    expect(inserted.flat()).toHaveLength(1)
    const rows = await db
      .select()
      .from(schema.builds)
      .where(eq(schema.builds.projectId, project.id))
    expect(rows).toHaveLength(1)

    // Non-parallel builds of the same commit are separate builds (re-runs).
    await db
      .insert(schema.builds)
      .values({ projectId: project.id, commitSha: 'c0ffee', number: 10 })
    await db
      .insert(schema.builds)
      .values({ projectId: project.id, commitSha: 'c0ffee', number: 11 })
  })

  it('requires parallel nonce and total together', async () => {
    await createOrganization(db, { name: 'Par', slug: 'par' })
    const { project } = await createProject(db, { orgSlug: 'par', name: 'p' })
    const code = await failCode(() =>
      db
        .insert(schema.builds)
        .values({ projectId: project.id, commitSha: 'x', number: 1, parallelNonce: 'n' }),
    )
    expect(code).toBe('23514')
  })

  it('upserts a retried shard instead of counting it twice', async () => {
    await createOrganization(db, { name: 'Retry', slug: 'retry' })
    const { project } = await createProject(db, { orgSlug: 'retry', name: 'p' })
    const [build] = await db
      .insert(schema.builds)
      .values({
        projectId: project.id,
        commitSha: 'x',
        number: 1,
        parallelNonce: 'n',
        parallelTotal: 2,
      })
      .returning()
    if (!build) throw new Error('no build')
    for (const shardIndex of ['0', '0', '1']) {
      // oxlint-disable-next-line no-await-in-loop -- shards finalize one after another to simulate a retry
      await db
        .insert(schema.buildShards)
        .values({ buildId: build.id, shardIndex })
        .onConflictDoUpdate({
          target: [schema.buildShards.buildId, schema.buildShards.shardIndex],
          set: { finalizedAt: new Date() },
        })
    }
    const shards = await db
      .select()
      .from(schema.buildShards)
      .where(eq(schema.buildShards.buildId, build.id))
    expect(shards.map((s) => s.shardIndex).toSorted()).toEqual(['0', '1'])
  })

  it('blocks deleting a file that an upload claim still relies on', async () => {
    await createOrganization(db, { name: 'Claims', slug: 'claims' })
    const { project } = await createProject(db, { orgSlug: 'claims', name: 'p' })
    const [build] = await db
      .insert(schema.builds)
      .values({ projectId: project.id, commitSha: 'x', number: 1 })
      .returning()
    if (!build) throw new Error('no build')
    await db.insert(schema.files).values({ sha256: h('c'), storageKey: 'k3', kind: 'screenshot' })
    await db.insert(schema.uploadClaims).values({ buildId: build.id, fileSha256: h('c') })
    const code = await failCode(() =>
      db.delete(schema.files).where(eq(schema.files.sha256, h('c'))),
    )
    expect(code).toBe('23001') // restrict_violation (ON DELETE RESTRICT)
  })

  it('treats user emails case-insensitively', async () => {
    await db.insert(schema.users).values({ email: 'Ada@Example.com' })
    const code = await failCode(() => db.insert(schema.users).values({ email: 'ada@example.com' }))
    expect(code).toBe('23505')
  })
})
