import { createTestDb, seedTeam } from '@circi/testing'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrationsFolder, pgErrorCode } from '#src/index.ts'
import * as schema from '#src/schema/index.ts'

/** Migrations apply cleanly, and the database itself enforces the plan's invariants (PLAN §6, §8). */

let t: createTestDb.Result

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
      'account',
      'apikey',
      'build_checks',
      'build_shards',
      'builds',
      'comments',
      'commit_ancestry',
      'email_code_requests',
      'files',
      'ignore_regions',
      'instance_settings',
      'integration_links',
      'integration_teams',
      'integrations',
      'invitation',
      'jobs',
      'known_devices',
      'member',
      'notification_preferences',
      'notifications',
      'pr_comments',
      'provider_deliveries',
      'review_requests',
      'review_rule_reviewers',
      'review_rules',
      'reviews',
      'saved_views',
      'screenshot_diffs',
      'screenshots',
      'session',
      'session_methods',
      'site_hostnames',
      'site_sessions',
      'site_tokens',
      'snapshot_reviews',
      'sso_provider',
      'static_site_files',
      'static_sites',
      'team_sites',
      'teams',
      'triage_items',
      'triage_rotation_members',
      'upload_claims',
      'user',
      'user_pinned_teams',
      'verification',
      'webhook_deliveries',
      'webhooks',
      'workspace',
      'workspace_auth_settings',
      'workspace_deletions',
      'workspace_domains',
      'workspace_settings',
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

  it('collapses concurrent shards into one build per (team, name, commit, nonce)', async () => {
    const { team } = await seedTeam(t.db)
    const build = {
      teamId: team.id,
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
              schema.builds.teamId,
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
    const rows = await t.db.select().from(schema.builds).where(eq(schema.builds.teamId, team.id))
    expect(rows).toHaveLength(1)

    // Non-parallel builds of the same commit are separate builds (re-runs).
    await t.db.insert(schema.builds).values({ teamId: team.id, commitSha: 'c0ffee', number: 10 })
    await t.db.insert(schema.builds).values({ teamId: team.id, commitSha: 'c0ffee', number: 11 })
  })

  it('requires parallel nonce and total together', async () => {
    const { team } = await seedTeam(t.db)
    const code = await failCode(() =>
      t.db
        .insert(schema.builds)
        .values({ teamId: team.id, commitSha: 'x', number: 1, parallelNonce: 'n' }),
    )
    expect(code).toBe('23514')
  })

  it('upserts a retried shard instead of counting it twice', async () => {
    const { team } = await seedTeam(t.db)
    const [build] = await t.db
      .insert(schema.builds)
      .values({
        teamId: team.id,
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
    const { team } = await seedTeam(t.db)
    const [build] = await t.db
      .insert(schema.builds)
      .values({ teamId: team.id, commitSha: 'x', number: 1 })
      .returning()
    if (!build) throw new Error('no build')
    await t.db.insert(schema.files).values({ sha256: h('c'), storageKey: 'k3', kind: 'screenshot' })
    await t.db.insert(schema.uploadClaims).values({ buildId: build.id, fileSha256: h('c') })
    const code = await failCode(() =>
      t.db.delete(schema.files).where(eq(schema.files.sha256, h('c'))),
    )
    expect(code).toBe('23001') // restrict_violation (ON DELETE RESTRICT)
  })

  it('only lets a team belong to an existing workspace', async () => {
    const code = await failCode(() =>
      t.db.insert(schema.teams).values({ workspaceId: 'no-such-workspace', slug: 'p', name: 'p' }),
    )
    expect(code).toBe('23503')
  })

  it('deletes a workspace’s teams and builds with it', async () => {
    const { team, workspace } = await seedTeam(t.db)
    await t.db.insert(schema.builds).values({ teamId: team.id, commitSha: 'abc1234', number: 1 })
    await t.db.delete(schema.workspace).where(eq(schema.workspace.id, workspace.id))
    expect(await t.db.select().from(schema.teams).where(eq(schema.teams.id, team.id))).toEqual([])
    expect(
      await t.db.select().from(schema.builds).where(eq(schema.builds.teamId, team.id)),
    ).toEqual([])
  })

  it('keeps a team when its CI key is deleted, with no token', async () => {
    const { team } = await seedTeam(t.db)
    const [key] = await t.db
      .insert(schema.apikey)
      .values({
        id: 'key-1',
        referenceId: team.workspaceId,
        key: 'hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    await t.db
      .update(schema.teams)
      .set({ ciKeyId: key?.id ?? null })
      .where(eq(schema.teams.id, team.id))
    await t.db.delete(schema.apikey).where(eq(schema.apikey.id, 'key-1'))
    const [after] = await t.db.select().from(schema.teams).where(eq(schema.teams.id, team.id))
    expect(after?.ciKeyId).toBeNull()
  })
})
