import { INSTANCE_LIMIT_DEFAULTS } from '@circi/core'
import { createInstanceConfig, INSTANCE_CONFIG_TTL_MS, type InstanceConfig } from '@circi/services'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { freshDatabase, type TestDatabase } from '#clients/database.ts'
import { useStack } from '#stack/vitest.ts'

const SECRET = 'instance-secret-for-the-e2e'

const env = (): InstanceConfig.Env => ({
  locked: [],
  workspaceCreation: 'admin',
  signIn: { password: true, email: true, sso: true },
  limits: { ...INSTANCE_LIMIT_DEFAULTS },
  sso: [],
})

/**
 * The instance settings on real Postgres, through several connection pools at once (each pool is
 * what another replica of the server would have). Saving takes an advisory lock and reads the
 * saved settings inside the transaction, which only separate connections can race.
 */
describe('instance settings under contention', () => {
  const ctx = useStack({ profile: 'default' })
  let database: TestDatabase
  let replicas: ReturnType<typeof createInstanceConfig>[]

  beforeAll(async () => {
    database = await freshDatabase(ctx.stack)
    // Four replicas, four pools of their own: every save below runs on its own connection.
    replicas = Array.from({ length: 4 }, (_, i) =>
      createInstanceConfig({
        db: database.open({ poolMax: 2, applicationName: `replica-${i}` }).db,
        authSecret: SECRET,
        env: env(),
      }),
    )
  })
  afterAll(async () => {
    await database.close()
  })
  beforeEach(async () => {
    await database.query(`delete from instance_settings where key like 'instance.%'`)
  })

  const replica = (i: number) => {
    const found = replicas[i % replicas.length]
    if (!found) throw new Error('no replica')
    return found
  }
  /** What the database says now, read by a replica that has never read before. */
  const fresh = async () => {
    const reader = createInstanceConfig({
      db: database.open({ poolMax: 1 }).db,
      authSecret: SECRET,
      env: env(),
    })
    return reader.get()
  }

  it('saves of different groups, at the same moment on separate connections, all persist', async () => {
    for (let round = 1; round <= 6; round += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one round of simultaneous saves after another
      await Promise.all([
        replica(0).setLimits({ gcGraceHours: round }),
        replica(1).saveSmtp({
          host: `smtp${round}.example.com`,
          port: 587,
          secure: false,
          user: 'mailer',
          from: 'ci@example.com',
          password: `pw-${round}`,
        }),
        replica(2).saveSlack({ clientId: `slack-${round}`, clientSecret: `secret-${round}` }),
        replica(3).saveSso({
          id: 'github',
          clientId: `gh-${round}`,
          clientSecret: `ghs-${round}`,
          trustedForEmail: true,
        }),
      ])
      // oxlint-disable-next-line no-await-in-loop -- read back what this round left
      const now = await fresh()
      expect(now.limits.gcGraceHours).toBe(round)
      expect(now.smtp).toMatchObject({
        host: `smtp${round}.example.com`,
        auth: { password: `pw-${round}` },
      })
      expect(now.slack).toEqual({ clientId: `slack-${round}`, clientSecret: `secret-${round}` })
      expect(now.sso.find((p) => p.id === 'github')).toMatchObject({
        clientId: `gh-${round}`,
        clientSecret: `ghs-${round}`,
      })
    }
  })

  it('saves of different fields of the same group serialize: none is lost', async () => {
    for (let round = 1; round <= 5; round += 1) {
      // The general group is one document holding all of these: every save reads it, changes one
      // field and writes it back, so without the lock a later writer would revert an earlier one.
      // oxlint-disable-next-line no-await-in-loop -- one round of simultaneous saves after another
      await Promise.all([
        replica(0).setLimits({ gcGraceHours: 10 + round }),
        replica(1).setLimits({ uploadTimeoutMinutes: 20 + round }),
        replica(2).setLimits({ jobRetentionDays: 30 + round }),
        replica(3).setLimits({ staticSitesMaxMb: 40 + round }),
        replica(0).setLimits({ webhookTimeoutSeconds: 5 + round }),
        replica(1).setWorkspaceCreation(round % 2 === 0 ? 'anyone' : 'admin'),
        replica(2).setSignIn({ sso: round % 2 === 0 }),
        replica(3).setSignIn({ email: round % 2 === 1 }),
        replica(0).setLimits({ defaultProjectRetentionDays: 50 + round }),
      ])
      // oxlint-disable-next-line no-await-in-loop -- read back what this round left
      const now = await fresh()
      expect(now.limits).toMatchObject({
        gcGraceHours: 10 + round,
        uploadTimeoutMinutes: 20 + round,
        jobRetentionDays: 30 + round,
        staticSitesMaxMb: 40 + round,
        webhookTimeoutSeconds: 5 + round,
        defaultProjectRetentionDays: 50 + round,
      })
      expect(now.workspaceCreation).toBe(round % 2 === 0 ? 'anyone' : 'admin')
      expect(now.signIn).toMatchObject({
        password: true,
        sso: round % 2 === 0,
        email: round % 2 === 1,
      })
    }
  })

  it('saves of the same field leave one of the values, and the rest of the group alone', async () => {
    await replica(0).setLimits({ jobRetentionDays: 77 })
    const values = [3, 5, 7, 9, 11, 13, 15, 17]
    await Promise.all(values.map((v, i) => replica(i).setLimits({ gcGraceHours: v })))
    const now = await fresh()
    expect(values).toContain(now.limits.gcGraceHours)
    expect(now.limits.jobRetentionDays).toBe(77)
    // The stored document is whole and valid JSON, not a torn write.
    const [row] = await database.query<{ value: string }>(
      `select value from instance_settings where key = 'instance.general'`,
    )
    expect(() => JSON.parse(row?.value ?? '')).not.toThrow()
  })
})

/** A clock a test moves by hand, so the replicas' 30 s TTL is crossed without waiting. */
const clock = () => {
  let at = Date.now()
  return { now: () => at, advance: (ms: number) => void (at += ms) }
}

describe('instance settings across replicas (one database, a pool and a cache each)', () => {
  const ctx = useStack({ profile: 'default' })
  let database: TestDatabase

  beforeAll(async () => {
    database = await freshDatabase(ctx.stack)
  })
  afterAll(async () => {
    await database.close()
  })

  it('a change saved by one replica is read by another once its TTL has run out, not before', async () => {
    const aClock = clock()
    const bClock = clock()
    const a = createInstanceConfig({
      db: database.open({ applicationName: 'replica-a' }).db,
      authSecret: SECRET,
      env: env(),
      now: aClock.now,
    })
    const b = createInstanceConfig({
      db: database.open({ applicationName: 'replica-b' }).db,
      authSecret: SECRET,
      env: env(),
      now: bClock.now,
    })
    const seen: number[] = []
    b.subscribe((effective) => seen.push(effective.limits.jobRetentionDays))

    // Both have read: B holds the default.
    const before = (await b.get()).limits.jobRetentionDays
    expect(await a.get()).toBeDefined()

    await a.setLimits({ jobRetentionDays: 31 })
    // The saving replica sees it at once; B trusts what it read until its TTL is over.
    expect((await a.get()).limits.jobRetentionDays).toBe(31)
    bClock.advance(INSTANCE_CONFIG_TTL_MS - 1_000)
    expect((await b.get()).limits.jobRetentionDays).toBe(before)
    bClock.advance(1_001)
    expect((await b.get()).limits.jobRetentionDays).toBe(31)
    expect(seen).toEqual([31])

    // And back the other way, with the cache cleared by hand instead of waiting.
    await b.setLimits({ jobRetentionDays: 45 })
    aClock.advance(INSTANCE_CONFIG_TTL_MS + 1)
    expect((await a.get()).limits.jobRetentionDays).toBe(45)
  })

  it('a replica keeps what it read when the database is unreachable, and recovers when it is back', async () => {
    const c = clock()
    const handle = database.open({ applicationName: 'replica-c' })
    const replica = createInstanceConfig({
      db: handle.db,
      authSecret: SECRET,
      env: env(),
      now: c.now,
    })
    await replica.get()
    const writer = createInstanceConfig({
      db: database.open({ applicationName: 'replica-d' }).db,
      authSecret: SECRET,
      env: env(),
    })
    await writer.setLimits({ gcGraceHours: 99 })
    // Every connection of this replica is terminated by the server; its pool replaces them.
    await database.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'replica-c'`,
    )
    c.advance(INSTANCE_CONFIG_TTL_MS + 1)
    // Whether the read fails or succeeds on a fresh connection, it never throws to the caller.
    await expect(replica.get()).resolves.toBeDefined()
    await expect
      .poll(async () => {
        c.advance(INSTANCE_CONFIG_TTL_MS + 1)
        return (await replica.get()).limits.gcGraceHours
      })
      .toBe(99)
  })
})
