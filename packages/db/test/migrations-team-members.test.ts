import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

import { migrationsFolder } from '#src/client.ts'

/** Runs a migration file statement by statement, as drizzle's migrator does. */
async function apply(client: PGlite, file: string): Promise<void> {
  const sql = await readFile(join(migrationsFolder, file), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    // oxlint-disable-next-line no-await-in-loop -- statements run in order
    if (statement.trim()) await client.exec(statement)
  }
}

describe('the team_members migration', () => {
  it('puts every current workspace member in every existing team, and nobody in another workspace', async () => {
    const files = (await readdir(migrationsFolder)).filter((f) => f.endsWith('.sql')).toSorted()
    const teamMembersAt = files.findIndex((f) => f.includes('team_members'))
    expect(teamMembersAt).toBeGreaterThan(0)

    // The database as it was before: members, teams, nobody in a team (there was no such thing).
    const client = new PGlite()
    for (const file of files.slice(0, teamMembersAt)) {
      // oxlint-disable-next-line no-await-in-loop -- migrations run in order
      await apply(client, file)
    }
    await client.exec(`
      insert into "user" (id, name, email) values
        ('u1', 'Ann', 'ann@example.com'), ('u2', 'Bob', 'bob@example.com'), ('u3', 'Cy', 'cy@example.com');
      insert into workspace (id, name, slug, created_at) values
        ('w1', 'One', 'one', now()), ('w2', 'Two', 'two', now()), ('w3', 'Empty', 'empty', now());
      insert into member (id, workspace_id, user_id, role, created_at) values
        ('m1', 'w1', 'u1', 'owner', now()), ('m2', 'w1', 'u2', 'member', now()),
        ('m3', 'w2', 'u3', 'owner', now()), ('m4', 'w2', 'u2', 'admin', now());
      insert into teams (id, workspace_id, slug, name) values
        ('00000000-0000-4000-8000-000000000001', 'w1', 'web', 'web'),
        ('00000000-0000-4000-8000-000000000002', 'w1', 'docs', 'docs'),
        ('00000000-0000-4000-8000-000000000003', 'w2', 'api', 'api'),
        ('00000000-0000-4000-8000-000000000004', 'w3', 'lonely', 'lonely');
    `)

    await apply(client, files[teamMembersAt] ?? '')

    const { rows } = await client.query<{ team: string; user: string }>(
      `select t.slug as team, tm.user_id as "user"
         from team_members tm join teams t on t.id = tm.team_id
        order by t.slug, tm.user_id`,
    )
    expect(rows).toEqual([
      { team: 'api', user: 'u2' },
      { team: 'api', user: 'u3' },
      { team: 'docs', user: 'u1' },
      { team: 'docs', user: 'u2' },
      { team: 'web', user: 'u1' },
      { team: 'web', user: 'u2' },
    ])
    const { rows: byWhom } = await client.query<{ added_by: string | null }>(
      `select distinct added_by from team_members`,
    )
    expect(byWhom).toEqual([{ added_by: null }])
    await client.close()
  })
})
