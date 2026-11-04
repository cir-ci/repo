import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema.ts'

export type Schema = typeof schema

/**
 * Any drizzle Postgres database with our schema: node-postgres in production, PGlite in tests.
 * Repository functions take this type so they run against both.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>

/** Works from both `src/` (development) and `dist/` (production): both sit one level below the package root. */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

export interface DbHandle {
  db: Database
  pool: pg.Pool
  ping(): Promise<void>
  close(): Promise<void>
}

export function createDb(options: {
  url: string
  poolMax?: number
  applicationName?: string
}): DbHandle {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.poolMax ?? 10,
    application_name: options.applicationName ?? 'zopheros',
  })
  const db = drizzle({ client: pool, schema })
  return {
    db,
    pool,
    async ping() {
      await pool.query('select 1')
    },
    async close() {
      await pool.end()
    },
  }
}

/** Arbitrary constant; serializes migrations when several containers start at once. */
const MIGRATION_LOCK_KEY = 7_340_183_311

export async function runMigrations(handle: DbHandle): Promise<void> {
  const client = await handle.pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      await migrate(drizzle({ client }), { migrationsFolder })
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}
