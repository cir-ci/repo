import { randomBytes } from 'node:crypto'

import { createDb, type DbHandle, runMigrations } from '@circi/db'
import { Client } from 'pg'

import type { Stack } from '#stack/stack.ts'

/**
 * A database of its own on a stack's real Postgres, migrated like production's, for tests that
 * need what PGlite (one in-process connection) can't give: several connections and processes,
 * advisory locks, `pg_stat_activity`. It is a sibling of the stack's `circi` database, so the
 * stack's server and worker never see it, and any number of files can use the same stack.
 */
export interface TestDatabase {
  /** Connection string of this database. */
  readonly url: string
  readonly name: string
  /** Opens a connection pool (its own set of connections, as another process would have). Closed by `close()`. */
  open(options?: { poolMax?: number; applicationName?: string }): DbHandle
  /** Runs one statement on a connection of its own (not any pool's), e.g. to inspect `pg_stat_activity`. */
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>
  /** Closes every pool opened here and drops the database. */
  close(): Promise<void>
}

const withDatabase = (url: string, name: string) => {
  const u = new URL(url)
  u.pathname = `/${name}`
  return u.toString()
}

export async function freshDatabase(stack: Pick<Stack, 'databaseUrl'>): Promise<TestDatabase> {
  const name = `t_${randomBytes(5).toString('hex')}`
  const admin = new Client({ connectionString: stack.databaseUrl })
  await admin.connect()
  try {
    await admin.query(`create database ${name}`)
  } finally {
    await admin.end()
  }
  const url = withDatabase(stack.databaseUrl, name)
  const handles = new Set<DbHandle>()
  const open: TestDatabase['open'] = (options = {}) => {
    const handle = createDb({
      url,
      ...(options.poolMax ? { poolMax: options.poolMax } : {}),
      ...(options.applicationName ? { applicationName: options.applicationName } : {}),
    })
    handles.add(handle)
    return handle
  }
  const migrator = open({ poolMax: 2 })
  await runMigrations(migrator)
  await migrator.close()
  handles.delete(migrator)
  return {
    url,
    name,
    open,
    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]) {
      const client = new Client({ connectionString: url })
      await client.connect()
      try {
        const res = await client.query<T>(text, params)
        return res.rows
      } finally {
        await client.end()
      }
    },
    async close() {
      await Promise.all([...handles].map((h) => h.close().catch(() => {})))
      const dropper = new Client({ connectionString: stack.databaseUrl })
      await dropper.connect()
      try {
        await dropper.query(`drop database if exists ${name} with (force)`)
      } finally {
        await dropper.end()
      }
    },
  }
}
