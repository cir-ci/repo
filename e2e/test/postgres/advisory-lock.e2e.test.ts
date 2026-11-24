import { type DbHandle, tryAdvisoryLock } from '@circi/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { freshDatabase, type TestDatabase } from '#clients/database.ts'
import { useStack } from '#stack/vitest.ts'

const gate = () => Promise.withResolvers<void>()

/**
 * The sweep lock (`tryAdvisoryLock`) on the stack's Postgres: "another process holds the lock"
 * is shown with separate connections. Each test uses a key of its
 * own, so a failure can't leave a lock that another test trips over.
 */
describe('tryAdvisoryLock on real Postgres', () => {
  const ctx = useStack({ profile: 'default' })
  let database: TestDatabase
  /** A pool of one connection, as `DATABASE_POOL_MAX=1` makes it. */
  let small: DbHandle
  /** A second process: a pool of its own. */
  let other: DbHandle

  beforeAll(async () => {
    database = await freshDatabase(ctx.stack)
    small = database.open({ poolMax: 1, applicationName: 'sweep-a' })
    other = database.open({ poolMax: 2, applicationName: 'sweep-b' })
  })
  afterAll(async () => {
    await database.close()
  })

  const locks = async () =>
    Number(
      (
        await database.query<{ n: string }>(
          `select count(*) as n from pg_locks where locktype = 'advisory' and database = (select oid from pg_database where datname = current_database())`,
        )
      )[0]?.n,
    )
  const lockConnections = async () =>
    Number(
      (
        await database.query<{ n: string }>(
          `select count(*) as n from pg_stat_activity where datname = current_database() and application_name like '%-lock'`,
        )
      )[0]?.n,
    )
  it('two callers with the same key: one runs, the other is skipped at once; a third runs after the first is done', async () => {
    const key = 'sweep:same-key'
    const hold = gate()
    let started = false
    const first = tryAdvisoryLock(small.db, key, async () => {
      started = true
      await hold.promise
      return 'first'
    })
    await expect.poll(() => started).toBe(true)

    // From another process, and from the same one: both see the lock taken, and neither waits.
    const began = Date.now()
    expect(await tryAdvisoryLock(other.db, key, async () => 'second')).toEqual({ ran: false })
    expect(await tryAdvisoryLock(small.db, key, async () => 'second')).toEqual({ ran: false })
    expect(Date.now() - began).toBeLessThan(3_000)
    // Another key is a different sweep: it runs beside the first.
    expect(await tryAdvisoryLock(other.db, 'sweep:other-key', async () => 'beside')).toEqual({
      ran: true,
      value: 'beside',
    })

    hold.resolve()
    expect(await first).toEqual({ ran: true, value: 'first' })
    expect(await tryAdvisoryLock(other.db, key, async () => 'third')).toEqual({
      ran: true,
      value: 'third',
    })
    expect(await locks()).toBe(0)
  })

  it('of several callers at the same moment, exactly one runs', async () => {
    const key = 'sweep:burst'
    let running = 0
    let mostAtOnce = 0
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        tryAdvisoryLock(i % 2 === 0 ? small.db : other.db, key, async () => {
          running += 1
          mostAtOnce = Math.max(mostAtOnce, running)
          // Long enough that every other caller has asked while this one holds the lock.
          await other.db.execute(sql`select pg_sleep(0.5)`)
          running -= 1
          return i
        }),
      ),
    )
    const ran = results.filter((r) => r.ran)
    expect(ran).toHaveLength(1)
    expect(results.filter((r) => !r.ran)).toHaveLength(5)
    expect(mostAtOnce).toBe(1)
    expect(await locks()).toBe(0)
  })

  it('releases the lock when fn throws, and the error reaches the caller', async () => {
    const key = 'sweep:throws'
    await expect(
      tryAdvisoryLock(small.db, key, async () => {
        throw new Error('the sweep broke')
      }),
    ).rejects.toThrow('the sweep broke')
    expect(await locks()).toBe(0)
    expect(await tryAdvisoryLock(other.db, key, async () => 'after')).toEqual({
      ran: true,
      value: 'after',
    })
  })

  it(
    'does not deadlock when fn uses the pool, even a pool of one connection',
    { timeout: 15_000 },
    async () => {
      const key = 'sweep:pool-of-one'
      const sweep = tryAdvisoryLock(small.db, key, async () => {
        // What a sweep does: queries and a transaction, on the pool the lock must not have taken.
        await small.db.execute(sql`select 1`)
        const inTx = await small.db.transaction(async (tx) => {
          await tx.execute(sql`select 2`)
          return 'tx'
        })
        const parallel = await Promise.all([1, 2, 3].map((n) => small.db.execute(sql`select ${n}`)))
        return { inTx, parallel: parallel.length }
      })
      // A deadlock would hang here until the test's own timeout, 15 s.
      const result = await sweep
      expect(result).toEqual({ ran: true, value: { inTx: 'tx', parallel: 3 } })
      expect(small.pool.options.max).toBe(1)
    },
  )

  it('leaks no connection: every lock connection is closed, and the pool is back to idle', async () => {
    for (let i = 0; i < 5; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one pass after another, as the timers make them
      await tryAdvisoryLock(small.db, `sweep:leak-${i}`, async () =>
        small.db.execute(sql`select 1`),
      )
    }
    await expect(
      tryAdvisoryLock(small.db, 'sweep:leak-throw', async () => {
        throw new Error('x')
      }),
    ).rejects.toThrow('x')
    // A skipped pass opens (and closes) a connection too.
    const hold = gate()
    let started = false
    const first = tryAdvisoryLock(other.db, 'sweep:leak-held', async () => {
      started = true
      await hold.promise
    })
    await expect.poll(() => started).toBe(true)
    expect(await tryAdvisoryLock(small.db, 'sweep:leak-held', async () => 1)).toEqual({
      ran: false,
    })
    // While the first still holds its lock, only its connection exists.
    expect(await lockConnections()).toBe(1)
    hold.resolve()
    await first

    await expect.poll(lockConnections, { timeout: 10_000 }).toBe(0)
    expect(await locks()).toBe(0)
    // The pools themselves: nothing checked out, no waiting query.
    expect(small.pool.totalCount).toBeLessThanOrEqual(1)
    expect(small.pool.waitingCount).toBe(0)
    expect(small.pool.idleCount).toBe(small.pool.totalCount)
    expect(other.pool.waitingCount).toBe(0)
    expect(other.pool.idleCount).toBe(other.pool.totalCount)
  })
})
