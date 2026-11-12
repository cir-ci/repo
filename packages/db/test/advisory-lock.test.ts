import { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { type Database, tryAdvisoryLock } from '#src/index.ts'

/** A database whose pool hands out one fake connection; `locked` is what the try-lock answers. */
function fakePoolDb(locked: boolean) {
  const queries: string[] = []
  const release = vi.fn<(broken?: boolean) => void>()
  const client = {
    query: async (text: string) => {
      queries.push(text.split('(')[0] ?? text)
      return { rows: [{ locked }] }
    },
    release,
  }
  const pool = Object.assign(Object.create(Pool.prototype), { connect: async () => client })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stub standing in for drizzle's handle
  const db = { $client: pool } as unknown as Database
  return { db, queries, release }
}

describe('tryAdvisoryLock', () => {
  it('skips when another session holds the lock, and returns the connection', async () => {
    const { db, queries, release } = fakePoolDb(false)
    const fn = vi.fn<() => Promise<number>>(async () => 1)
    expect(await tryAdvisoryLock(db, 'k', fn)).toEqual({ ran: false })
    expect(fn).not.toHaveBeenCalled()
    expect(queries).toEqual(['select pg_try_advisory_lock'])
    expect(release).toHaveBeenCalledWith(false)
  })

  it('runs fn with the lock held, then unlocks and releases, even when fn throws', async () => {
    const { db, queries, release } = fakePoolDb(true)
    expect(await tryAdvisoryLock(db, 'k', async () => 'ok')).toEqual({ ran: true, value: 'ok' })
    await expect(
      tryAdvisoryLock(db, 'k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(queries).toEqual([
      'select pg_try_advisory_lock',
      'select pg_advisory_unlock',
      'select pg_try_advisory_lock',
      'select pg_advisory_unlock',
    ])
    expect(release).toHaveBeenCalledTimes(2)
  })
})
