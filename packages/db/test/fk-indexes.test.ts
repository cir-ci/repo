import { createTestDb } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function rows(query: string): Promise<Record<string, string>[]> {
  return (await t.client.query<Record<string, string>>(query)).rows
}

describe('indexes', () => {
  it('has the indexes that keep deletes from scanning child tables', async () => {
    const found = await rows(
      `select indexname from pg_indexes where schemaname = 'public' and indexname in
       ('screenshot_diffs_base_screenshot_idx','screenshot_diffs_head_screenshot_idx','builds_base_build_idx','files_thumbnail_idx')`,
    )
    expect(found.map((r) => String(r.indexname)).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'builds_base_build_idx',
      'files_thumbnail_idx',
      'screenshot_diffs_base_screenshot_idx',
      'screenshot_diffs_head_screenshot_idx',
    ])
  })

  it('indexes every foreign key but the few small or generated tables named here', async () => {
    const missing = await rows(`
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
        )
      order by 1, 2`)
    // Unindexed on purpose: "who created or added it" columns of tables with a handful of rows per
    // workspace (a scan on a person's deletion costs nothing), and better-auth's generated tables.
    expect(missing.map((r) => `${r.tbl}.${r.col}`)).toEqual([
      'ignore_regions.created_by',
      'integration_links.created_by',
      'integrations.created_by',
      'invitation.inviter_id',
      'project_members.added_by',
      'projects.ci_key_created_by',
      'projects.review_overdue_notify_user_id',
      'sso_provider.user_id',
      'user_preferences.last_workspace_id',
    ])
  })
})
