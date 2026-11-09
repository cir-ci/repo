import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'

import { type Database, migrationsFolder } from '#src/client.ts'

export namespace getMigrationStatus {
  export interface Result {
    /** Migrations the database has applied. */
    applied: number
    /** Migrations that ship with this version of CirCI. */
    available: number
  }
}

/**
 * How many migrations the database has applied against how many this version ships (the entries
 * of the migrations folder's journal). Fewer applied than available means the server has not
 * migrated yet; more means the database was migrated by a newer version.
 */
export async function getMigrationStatus(
  db: Database,
  folder: string = migrationsFolder,
): Promise<getMigrationStatus.Result> {
  const journal: unknown = JSON.parse(await readFile(join(folder, 'meta', '_journal.json'), 'utf8'))
  const entries: unknown =
    typeof journal === 'object' && journal !== null ? Reflect.get(journal, 'entries') : undefined
  const available = Array.isArray(entries) ? entries.length : 0
  let applied = 0
  try {
    const result = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    )
    const rows: unknown =
      typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined
    applied = Array.isArray(rows) ? Number(Reflect.get(Object(rows[0]), 'n') ?? 0) : 0
  } catch {
    // No migrations table yet: nothing is applied.
  }
  return { applied, available }
}

/** Rejects when the database cannot answer a trivial query. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`)
}
