import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'

import { migrationsFolder } from '#src/index.ts'

/**
 * 0023 renames `provider_connections.installation_id` to `external_id` and adds credentials.
 * Hand-checked on legacy rows: apply everything before it, insert a GitHub connection, apply 0023.
 */

let client: PGlite
afterAll(async () => {
  await client.close()
})

/** A fresh database with every migration before the one starting with `prefix` applied; returns the migration's statements. */
async function migrateUntil(prefix: string): Promise<string[]> {
  client = new PGlite()
  const files = readdirSync(migrationsFolder)
    .filter((f) => f.endsWith('.sql'))
    .toSorted()
  const index = files.findIndex((f) => f.startsWith(prefix))
  expect(index).toBeGreaterThan(0)
  for (const file of files.slice(0, index)) {
    for (const s of statements(file)) {
      // oxlint-disable-next-line no-await-in-loop -- statements must run in order
      await client.exec(s)
    }
  }
  return statements(files[index] ?? '')
}

function statements(file: string): string[] {
  return readFileSync(join(migrationsFolder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('0023_integrations', () => {
  it('keeps existing GitHub connections, uniqueness included', async () => {
    client = new PGlite()
    const files = readdirSync(migrationsFolder)
      .filter((f) => f.endsWith('.sql'))
      .toSorted()
    const index = files.findIndex((f) => f.startsWith('0023_'))
    expect(index).toBeGreaterThan(0)
    for (const file of files.slice(0, index)) {
      for (const s of statements(file)) {
        // oxlint-disable-next-line no-await-in-loop -- statements must run in order
        await client.exec(s)
      }
    }
    await client.exec(`
      insert into organization (id, name, slug, created_at) values ('o1', 'Acme', 'acme', now());
      insert into provider_connections (org_id, kind, installation_id) values ('o1', 'github', '4242');
    `)
    for (const s of statements(files[index] ?? '')) {
      // oxlint-disable-next-line no-await-in-loop -- statements must run in order
      await client.exec(s)
    }
    const rows = await client.query<{
      kind: string
      external_id: string
      encrypted_credentials: null
    }>('select kind, external_id, encrypted_credentials from provider_connections')
    expect(rows.rows).toEqual([
      { kind: 'github', external_id: '4242', encrypted_credentials: null },
    ])
    await expect(
      client.exec(
        `insert into provider_connections (org_id, kind, external_id) values ('o1', 'github', '4242')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i)
  })
})

describe('0026_move_links', () => {
  it('moves figma_links and issue_links into integration_links, then drops them', async () => {
    const migration = await migrateUntil('0026_')
    await client.exec(`
      insert into organization (id, name, slug, created_at) values ('o1', 'Acme', 'acme', now());
      insert into "user" (id, name, email) values ('u1', 'Lou', 'lou@acme.test');
      insert into projects (id, org_id, slug, name) values ('00000000-0000-0000-0000-0000000000a1', 'o1', 'web', 'Web');
      insert into builds (id, project_id, number, commit_sha) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 1, 'abc');
      insert into integrations (id, org_id, kind, display_name, external_id) values
        ('00000000-0000-0000-0000-0000000000f1', 'o1', 'figma', 'Lou', 'fu-1'),
        ('00000000-0000-0000-0000-0000000000f2', 'o1', 'linear', 'Acme', 'lin-1');
      insert into integration_projects (integration_id, project_id, external_ref, extra) values
        ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'FileKey12345',
          '{"name": "Checkout", "frames": {"1:2": "Cart"}, "frameCount": 9}'),
        ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 'team-1',
          '{"targetName": "Web (WEB)"}');
      insert into figma_links (id, integration_id, project_id, snapshot_pattern, file_key, node_id, source, created_by) values
        ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'cart', 'FileKey12345', '1:2', 'manual', 'u1'),
        ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'pay', 'FileKey12345', '3:4', 'auto', null);
      insert into issue_links (id, build_id, snapshot_name, integration_id, issue_key, url, title, created_by) values
        ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'cart', '00000000-0000-0000-0000-0000000000f2', 'WEB-1', 'https://linear.test/WEB-1', 'Cart is off', 'u1'),
        ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000f2', 'WEB-2', 'https://linear.test/WEB-2', 'Build is off', null);
    `)
    for (const s of migration) {
      // oxlint-disable-next-line no-await-in-loop -- statements must run in order
      await client.exec(s)
    }

    const figma = await client.query(
      `select id, subject, external_ref, url, title, payload, created_by, project_id is not null as project_wide, build_id
       from integration_links where kind = 'figma-frame' order by subject`,
    )
    expect(figma.rows).toEqual([
      {
        id: '00000000-0000-0000-0000-0000000000c1',
        subject: 'cart',
        external_ref: 'FileKey12345:1:2',
        url: 'https://www.figma.com/design/FileKey12345?node-id=1-2',
        title: 'Cart',
        payload: {
          fileKey: 'FileKey12345',
          nodeId: '1:2',
          source: 'manual',
          scope: 'FileKey12345',
        },
        created_by: 'u1',
        project_wide: true,
        build_id: null,
      },
      {
        id: '00000000-0000-0000-0000-0000000000c2',
        subject: 'pay',
        external_ref: 'FileKey12345:3:4',
        url: 'https://www.figma.com/design/FileKey12345?node-id=3-4',
        title: null,
        payload: { fileKey: 'FileKey12345', nodeId: '3:4', source: 'auto', scope: 'FileKey12345' },
        created_by: null,
        project_wide: true,
        build_id: null,
      },
    ])

    const issues = await client.query(
      `select id, subject, external_ref, url, title, payload, created_by, project_id, build_id
       from integration_links where kind = 'issue' order by external_ref`,
    )
    expect(issues.rows).toEqual([
      {
        id: '00000000-0000-0000-0000-0000000000d1',
        subject: null,
        external_ref: 'WEB-1',
        url: 'https://linear.test/WEB-1',
        title: 'Cart is off',
        payload: { snapshotName: 'cart' },
        created_by: 'u1',
        project_id: null,
        build_id: '00000000-0000-0000-0000-0000000000b1',
      },
      {
        id: '00000000-0000-0000-0000-0000000000d2',
        subject: null,
        external_ref: 'WEB-2',
        url: 'https://linear.test/WEB-2',
        title: 'Build is off',
        payload: { snapshotName: null },
        created_by: null,
        project_id: null,
        build_id: '00000000-0000-0000-0000-0000000000b1',
      },
    ])

    // The target's name is `extra.name` for every integration; the Figma frame cache is gone.
    const extras = await client.query(
      `select i.kind, ip.extra from integration_projects ip join integrations i on i.id = ip.integration_id order by i.kind`,
    )
    expect(extras.rows).toEqual([
      { kind: 'figma', extra: { name: 'Checkout' } },
      { kind: 'linear', extra: { name: 'Web (WEB)' } },
    ])

    const tables = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename in ('figma_links', 'issue_links')`,
    )
    expect(tables.rows).toEqual([])
  })
})
