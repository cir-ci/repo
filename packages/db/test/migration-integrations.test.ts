import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'

import { migrationsFolder } from '../src/index.ts'

/**
 * 0023 renames `provider_connections.installation_id` to `external_id` and adds credentials.
 * Hand-checked on legacy rows: apply everything before it, insert a GitHub connection, apply 0023.
 */

let client: PGlite
afterAll(async () => {
  await client.close()
})

const statements = (file: string) =>
  readFileSync(join(migrationsFolder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)

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
