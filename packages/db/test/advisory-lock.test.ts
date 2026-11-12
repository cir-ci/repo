import { createTestDb } from '@circi/db/testing'
import { Client, Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { type Database, tryAdvisoryLock } from '#src/index.ts'

/**
 * A database whose pool must never be used (`connect` throws: the lock may not take a pooled
 * connection) and whose lock connection is a fake `Client`; `locked` is what the try-lock answers.
 */
function fakePoolDb(locked: boolean) {
  const queries: string[] = []
  const calls: string[] = []
  const client = Object.assign(Object.create(Client.prototype), {
    connect: async () => void calls.push('connect'),
    query: async (text: string) => {
      queries.push(text.split('(')[0] ?? text)
      return { rows: [{ locked }] }
    },
    end: async () => void calls.push('end'),
    on: () => client,
  })
  const connect = vi.fn<() => Promise<never>>(async () => {
    throw new Error('the pool was used')
  })
  const pool = Object.assign(Object.create(Pool.prototype), {
    connect,
    options: { connectionString: 'postgres://x', max: 1, application_name: 'circi' },
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stub standing in for drizzle's handle
  const db = { $client: pool } as unknown as Database
  const newClient = vi.fn<(p: Pool) => Client>(() => client)
  return { db, queries, calls, connect, newClient }
}

describe('tryAdvisoryLock', () => {
  it('skips when another session holds the lock, and closes its connection', async () => {
    const { db, queries, calls, newClient } = fakePoolDb(false)
    const fn = vi.fn<() => Promise<number>>(async () => 1)
    expect(await tryAdvisoryLock(db, 'k', fn, { newClient })).toEqual({ ran: false })
    expect(fn).not.toHaveBeenCalled()
    expect(queries).toEqual(['select pg_try_advisory_lock'])
    expect(calls).toEqual(['connect', 'end'])
  })

  it('runs fn with the lock held, then unlocks and closes, even when fn throws', async () => {
    const { db, queries, calls, newClient } = fakePoolDb(true)
    expect(await tryAdvisoryLock(db, 'k', async () => 'ok', { newClient })).toEqual({
      ran: true,
      value: 'ok',
    })
    await expect(
      tryAdvisoryLock(
        db,
        'k',
        async () => {
          throw new Error('boom')
        },
        { newClient },
      ),
    ).rejects.toThrow('boom')
    expect(queries).toEqual([
      'select pg_try_advisory_lock',
      'select pg_advisory_unlock',
      'select pg_try_advisory_lock',
      'select pg_advisory_unlock',
    ])
    expect(calls).toEqual(['connect', 'end', 'connect', 'end'])
  })

  it('never takes a connection from the pool, so a pool of one cannot deadlock a sweep', async () => {
    const { db, connect, newClient } = fakePoolDb(true)
    // fn uses the pool (as a sweep's own queries do) while the lock is held.
    const result = await tryAdvisoryLock(db, 'k', async () => 'swept', { newClient })
    expect(result).toEqual({ ran: true, value: 'swept' })
    expect(connect).not.toHaveBeenCalled()
    expect(newClient).toHaveBeenCalledOnce()
  })

  it('refuses a transaction instead of quietly running without a lock', async () => {
    const t = await createTestDb()
    try {
      await t.db.transaction(async (tx) => {
        await expect(tryAdvisoryLock(tx, 'k', async () => 1)).rejects.toThrow('not a transaction')
      })
      // The database itself (no pool in the test database) just runs.
      expect(await tryAdvisoryLock(t.db, 'k', async () => 1)).toEqual({ ran: true, value: 1 })
    } finally {
      await t.close()
    }
  })
})
