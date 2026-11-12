import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { Client, Pool } from 'pg'

import * as schema from './schema/index.ts'

export type Schema = typeof schema

/**
 * Any drizzle Postgres database with our schema: node-postgres in production, PGlite in tests.
 * Repository functions take this type so they run against both.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>

/**
 * `packages/db/migrations` when running from the source tree (this file sits one level below the
 * package root). The server bundle moves this code, so the image points `CIRCI_MIGRATIONS` at the
 * copy it ships (deploy/Dockerfile); `@circi/config` reads it and the caller passes it to
 * `runMigrations`. `test/migrations-path.test.ts` pins the default.
 */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

/**
 * Subscribes to a Postgres NOTIFY channel on a dedicated connection. Resolves once LISTEN is
 * active, with a function that stops listening and closes the connection. `onLost` is called
 * (once) if the connection drops unexpectedly; the subscription is then dead and the caller may
 * subscribe again.
 */
export type ListenFn = (
  channel: string,
  onNotify: (payload: string) => void,
  onLost?: (err: Error) => void,
) => Promise<() => Promise<void>>

export interface DbHandle {
  db: Database
  pool: Pool
  /** LISTEN on a dedicated connection (not taken from the pool). */
  listen: ListenFn
  ping(): Promise<void>
  close(): Promise<void>
}

export function createDb(options: {
  url: string
  poolMax?: number
  applicationName?: string
  /**
   * Told when Postgres drops a pooled connection (a restart, a failover, the network). Without a
   * listener node-postgres re-throws that `error` event and the process exits; with one the error
   * is reported here, the query on that connection fails as usual, and the pool replaces the
   * connection.
   */
  onConnectionError?: (err: Error) => void
}): DbHandle {
  const pool = new Pool({
    connectionString: options.url,
    max: options.poolMax ?? 10,
    application_name: options.applicationName ?? 'circi',
  })
  const connectionError = (err: Error) => options.onConnectionError?.(err)
  // An idle connection's error comes to the pool; a checked-out one's to the client itself.
  pool.on('error', connectionError)
  pool.on('connect', (client) => {
    client.on('error', connectionError)
  })
  const db = drizzle({ client: pool, schema })
  const listeners = new Set<() => Promise<void>>()
  const listen: ListenFn = async (channel, onNotify, onLost) => {
    const client = new Client({
      connectionString: options.url,
      application_name: `${options.applicationName ?? 'circi'}-listen`,
    })
    let closing = false
    let lost = false
    const lose = (err: Error) => {
      if (closing || lost) return
      lost = true
      listeners.delete(stop)
      client.end().catch(() => {})
      onLost?.(err)
    }
    client.on('error', lose)
    client.on('end', () => lose(new Error('listen connection closed')))
    client.on('notification', (msg) => onNotify(msg.payload ?? ''))
    async function stop(): Promise<void> {
      if (closing) return
      closing = true
      listeners.delete(stop)
      await client.end().catch(() => {})
    }
    try {
      await client.connect()
      // The channel is one of our constants, never user input; LISTEN can't take a parameter.
      await client.query(`LISTEN ${client.escapeIdentifier(channel)}`)
    } catch (err) {
      closing = true
      await client.end().catch(() => {})
      throw err
    }
    listeners.add(stop)
    return stop
  }
  return {
    db,
    pool,
    listen,
    async ping() {
      await pool.query('select 1')
    },
    async close() {
      await Promise.all([...listeners].map((stop) => stop()))
      await pool.end()
    },
  }
}

/** Arbitrary constant; serializes migrations when several containers start at once. */
const MIGRATION_LOCK_KEY = 7_340_183_311

export async function runMigrations(
  handle: DbHandle,
  folder: string = migrationsFolder,
): Promise<void> {
  const client = await handle.pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      await migrate(drizzle({ client }), { migrationsFolder: folder })
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

/**
 * Runs `fn` in a transaction holding a Postgres advisory lock on `key`, so work that must not run
 * twice at once (several worker lanes or processes) is serialized; the lock is released when the
 * transaction ends. `fn` should use the transaction it is given.
 */
export async function withAdvisoryLock<T>(
  db: Database,
  key: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
    return fn(tx)
  })
}

/**
 * Runs `fn` only if no other connection holds the session-level advisory lock on `key`
 * (`pg_try_advisory_lock`): resolves to `{ ran: false }` at once when another process has it, so a
 * periodic sweep is skipped, not queued. The lock sits on one connection taken from the pool for
 * the duration; `fn` runs on the normal `db` with its own short transactions, and the lock is
 * released (and the connection returned) when it ends. Without a pool (the in-process test
 * database has a single session, so there is nothing to contend with) it just runs `fn`.
 */
export async function tryAdvisoryLock<T>(
  db: Database,
  key: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const pool: unknown = Reflect.get(db, '$client')
  if (!(pool instanceof Pool)) return { ran: true, value: await fn() }
  const client = await pool.connect()
  let broken = false
  try {
    const res = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as locked',
      [key],
    )
    if (res.rows[0]?.locked !== true) return { ran: false }
    try {
      return { ran: true, value: await fn() }
    } finally {
      // If the unlock fails the connection is dropped, which frees the lock with the session.
      await client
        .query('select pg_advisory_unlock(hashtextextended($1, 0))', [key])
        .catch(() => (broken = true))
    }
  } finally {
    client.release(broken)
  }
}
