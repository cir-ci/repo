import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createOrganization,
  createProject,
  migrationsFolder,
  pgErrorCode,
  schema,
} from '../src/index.ts'
import { createTestDb, type TestDb } from './helpers.ts'

/** Migrations apply cleanly, and the database itself enforces the plan's invariants (PLAN §6, §8). */

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
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
  it('create every table', async () => {
    const res = await t.client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    )
    expect(res.rows.map((r) => r.tablename)).toEqual([
      'build_shards',
      'builds',
      'commit_ancestry',
      'files',
      'jobs',
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
      migrate(drizzle({ client: t.client, schema }), { migrationsFolder }),
    ).resolves.toBeUndefined()
  })
})

/** A fake sha256 made of one repeated hex digit. */
const h = (c: string) => c.repeat(64)

describe('schema constraints from the plan', () => {
  it('only accepts lowercase hex sha256 file ids', async () => {
    const code = await failCode(() =>
      t.db.insert(schema.files).values({ sha256: 'ABC', storageKey: 'k1', kind: 'screenshot' }),
    )
    expect(code).toBe('23514')
  })

  it('keeps status and verified_at consistent', async () => {
    const code = await failCode(() =>
      t.db
        .insert(schema.files)
        .values({ sha256: h('a'), storageKey: 'k2', kind: 'screenshot', status: 'verified' }),
    )
    expect(code).toBe('23514')
    await t.db.insert(schema.files).values({
      sha256: h('a'),
      storageKey: 'k2',
      kind: 'screenshot',
      status: 'verified',
      verifiedAt: new Date(),
    })
  })

  it('collapses concurrent shards into one build per (project, name, commit, nonce)', async () => {
    await createOrganization(t.db, { name: 'Shards', slug: 'shards' })
    const { project } = await createProject(t.db, { orgSlug: 'shards', name: 'p' })
    const build = {
      projectId: project.id,
      commitSha: 'c0ffee',
      parallelNonce: 'run-1',
      parallelTotal: 3,
    }
    const inserted = await Promise.all(
      [1, 2, 3].map((n) =>
        t.db
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
    const rows = await t.db
      .select()
      .from(schema.builds)
      .where(eq(schema.builds.projectId, project.id))
    expect(rows).toHaveLength(1)

    // Non-parallel builds of the same commit are separate builds (re-runs).
    await t.db
      .insert(schema.builds)
      .values({ projectId: project.id, commitSha: 'c0ffee', number: 10 })
    await t.db
      .insert(schema.builds)
      .values({ projectId: project.id, commitSha: 'c0ffee', number: 11 })
  })

  it('requires parallel nonce and total together', async () => {
    await createOrganization(t.db, { name: 'Par', slug: 'par' })
    const { project } = await createProject(t.db, { orgSlug: 'par', name: 'p' })
    const code = await failCode(() =>
      t.db
        .insert(schema.builds)
        .values({ projectId: project.id, commitSha: 'x', number: 1, parallelNonce: 'n' }),
    )
    expect(code).toBe('23514')
  })

  it('upserts a retried shard instead of counting it twice', async () => {
    await createOrganization(t.db, { name: 'Retry', slug: 'retry' })
    const { project } = await createProject(t.db, { orgSlug: 'retry', name: 'p' })
    const [build] = await t.db
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
      await t.db
        .insert(schema.buildShards)
        .values({ buildId: build.id, shardIndex })
        .onConflictDoUpdate({
          target: [schema.buildShards.buildId, schema.buildShards.shardIndex],
          set: { finalizedAt: new Date() },
        })
    }
    const shards = await t.db
      .select()
      .from(schema.buildShards)
      .where(eq(schema.buildShards.buildId, build.id))
    expect(shards.map((s) => s.shardIndex).toSorted()).toEqual(['0', '1'])
  })

  it('blocks deleting a file that an upload claim still relies on', async () => {
    await createOrganization(t.db, { name: 'Claims', slug: 'claims' })
    const { project } = await createProject(t.db, { orgSlug: 'claims', name: 'p' })
    const [build] = await t.db
      .insert(schema.builds)
      .values({ projectId: project.id, commitSha: 'x', number: 1 })
      .returning()
    if (!build) throw new Error('no build')
    await t.db.insert(schema.files).values({ sha256: h('c'), storageKey: 'k3', kind: 'screenshot' })
    await t.db.insert(schema.uploadClaims).values({ buildId: build.id, fileSha256: h('c') })
    const code = await failCode(() =>
      t.db.delete(schema.files).where(eq(schema.files.sha256, h('c'))),
    )
    expect(code).toBe('23001') // restrict_violation (ON DELETE RESTRICT)
  })

  it('treats user emails case-insensitively', async () => {
    await t.db.insert(schema.users).values({ email: 'Ada@Example.com' })
    const code = await failCode(() =>
      t.db.insert(schema.users).values({ email: 'ada@example.com' }),
    )
    expect(code).toBe('23505')
  })
})
