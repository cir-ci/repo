import type { createTestDb } from '@circi/db/testing'

/**
 * Remembers every row of the test database now and returns a function that puts the database
 * back to exactly that: for a file that builds an expensive fixture once (workspaces, signed-in
 * accounts, builds) and gives each test the same starting state through `beforeEach`. Tests
 * then can't see each other's rows, whatever order they run in. Sequences are not rewound, so
 * ids handed out later never collide with restored ones.
 */
export async function snapshotDb(
  t: Pick<createTestDb.Result, 'client'>,
): Promise<() => Promise<void>> {
  const { client } = t
  const { rows: tables } = await client.query<{ name: string }>(
    `select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public' order by 1`,
  )
  const rows = new Map<string, string>()
  for (const { name } of tables) {
    // oxlint-disable-next-line no-await-in-loop -- one table at a time on one connection
    const { rows: copy } = await client.query<{ data: string }>(
      `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text as data from ${name} x`,
    )
    rows.set(name, copy[0]?.data ?? '[]')
  }
  return async () => {
    // One connection for the whole restore: `set local` and the triggers it turns off hold only
    // inside this transaction.
    const conn = await client.connect()
    try {
      await conn.query('begin')
      await conn.query(`set local session_replication_role = replica`)
      await conn.query(`truncate ${tables.map((x) => x.name).join(', ')} cascade`)
      for (const { name } of tables) {
        const data = rows.get(name) ?? '[]'
        if (data === '[]') continue
        // oxlint-disable-next-line no-await-in-loop -- one table at a time on one connection
        await conn.query(
          `insert into ${name} overriding system value select * from jsonb_populate_recordset(null::${name}, $1::jsonb)`,
          [data],
        )
      }
      await conn.query('commit')
    } catch (err) {
      await conn.query('rollback').catch(() => {})
      throw err
    } finally {
      conn.release()
    }
  }
}
