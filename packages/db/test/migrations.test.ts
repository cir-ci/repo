import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrationsFolder } from '#src/index.ts'

/**
 * Migration 0003 moves existing organizations, users and memberships into better-auth's tables.
 * It's hand-written SQL, so it's tested on legacy rows: apply 0000–0002, insert data the old
 * way, apply 0003, and check what came across.
 */

let client: PGlite

function migrationStatements(file: string): string[] {
  return readFileSync(join(migrationsFolder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function apply(file: string) {
  for (const statement of migrationStatements(file)) {
    // oxlint-disable-next-line no-await-in-loop -- statements must run in order
    await client.exec(statement)
  }
}

beforeAll(async () => {
  client = new PGlite()
  for (const file of [
    '0000_initial.sql',
    '0001_m1_uploads_and_jobs.sql',
    '0002_better_auth_tables.sql',
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- migrations must run in order
    await apply(file)
  }
})
afterAll(async () => {
  await client.close()
})

describe('0003_drop_legacy_auth', () => {
  it('carries organizations, users, memberships and their projects across', async () => {
    const org = '11111111-1111-1111-1111-111111111111'
    const ada = '22222222-2222-2222-2222-222222222222'
    const bob = '33333333-3333-3333-3333-333333333333'
    const project = '44444444-4444-4444-4444-444444444444'
    await client.exec(`
      insert into organizations (id, slug, name) values ('${org}', 'acme', 'Acme');
      insert into users (id, email, name) values
        ('${ada}', 'Ada@Example.com', 'Ada'),
        ('${bob}', 'bob@example.com', null);
      insert into memberships (org_id, user_id, role) values
        ('${org}', '${ada}', 'owner'),
        ('${org}', '${bob}', 'viewer');
      insert into projects (id, org_id, slug, name, token_hash, token_hint)
        values ('${project}', '${org}', 'web', 'Web', 'abc', 'zop_xxxxxx…');
    `)

    await apply('0003_drop_legacy_auth.sql')

    const orgs = await client.query<{ id: string; slug: string; name: string }>(
      'select id, slug, name from organization',
    )
    expect(orgs.rows).toEqual([{ id: org, slug: 'acme', name: 'Acme' }])

    // Emails are lower-cased, and a missing name falls back to the email.
    const users = await client.query<{ email: string; name: string }>(
      'select email, name from "user" order by email',
    )
    expect(users.rows).toEqual([
      { email: 'ada@example.com', name: 'Ada' },
      { email: 'bob@example.com', name: 'bob@example.com' },
    ])

    // `viewer` has no equivalent in better-auth's default roles, so it becomes `member`.
    const members = await client.query<{ user_id: string; role: string }>(
      'select user_id, role from member order by role',
    )
    expect(members.rows).toEqual([
      { user_id: bob, role: 'member' },
      { user_id: ada, role: 'owner' },
    ])

    // The project survives, pointing at the migrated organization, with no CI key until rotated.
    const projects = await client.query<{ id: string; org_id: string; ci_key_id: string | null }>(
      'select id, org_id, ci_key_id from projects',
    )
    expect(projects.rows).toEqual([{ id: project, org_id: org, ci_key_id: null }])

    const legacy = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename in ('organizations', 'users', 'memberships')",
    )
    expect(legacy.rows).toEqual([])
  })
})
