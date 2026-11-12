import type { InstanceAdmin } from '@circi/api'
import { INSTANCE_LIMIT_DEFAULTS } from '@circi/core'
import { createDb } from '@circi/db'
import { createInstanceConfig, INSTANCE_CONFIG_TTL_MS, type InstanceConfig } from '@circi/services'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { useStack } from '#stack/vitest.ts'

/** `BETTER_AUTH_SECRET` of the stack (e2e/compose.yml): the key the saved secrets are sealed with. */
const STACK_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123456789'

const env = (): InstanceConfig.Env => ({
  locked: [],
  workspaceCreation: 'admin',
  signIn: { password: true, email: true, sso: true },
  limits: { ...INSTANCE_LIMIT_DEFAULTS },
  sso: [],
})

/**
 * Instance settings between two real processes: the server in the container, and this test's
 * process standing in for a second replica (its own pool, its own cache) on the stack's database.
 * The server's cache lives 30 s (`INSTANCE_CONFIG_TTL_MS`, not configurable), so the second half
 * of this test waits that out for real. Dedicated stack: it changes instance-wide settings.
 */
describe('instance settings picked up across processes', () => {
  const ctx = useStack({ dedicated: true, setup: true })
  let handle: ReturnType<typeof createDb>

  beforeAll(() => {
    handle = createDb({ url: ctx.stack.databaseUrl, poolMax: 2, applicationName: 'replica-test' })
  })
  afterAll(async () => {
    await handle.close()
  })

  const serverView = async () =>
    (await ctx.setup.session.get<InstanceAdmin.Settings>('/api/instance/settings')).config.limits
      .jobRetentionDays.value

  it('a change saved through the server is read by another process; one saved by another process reaches the server within its TTL', async () => {
    const { session } = ctx.setup
    let clock = Date.now()
    const replica = createInstanceConfig({
      db: handle.db,
      authSecret: STACK_SECRET,
      env: env(),
      now: () => clock,
    })

    // The other process has read the settings (the default) and trusts that for its TTL.
    const before = (await replica.get()).limits.jobRetentionDays
    // The server saves: it reads again at once, so it answers with the new value.
    const saved = await session.put<InstanceAdmin.Config>('/api/instance/config/limits', {
      jobRetentionDays: 21,
    })
    const serverSavedAt = Date.now()
    expect(saved.limits.jobRetentionDays.value).toBe(21)
    expect(await serverView()).toBe(21)
    // The other process still holds what it read, until its TTL is over; then it reads 21.
    expect((await replica.get()).limits.jobRetentionDays).toBe(before)
    clock += INSTANCE_CONFIG_TTL_MS + 1
    expect((await replica.get()).limits.jobRetentionDays).toBe(21)

    // The other way: this process saves; the server answers from what it read at its own save,
    // and reads the database again when its TTL is over, 30 s after that read.
    await replica.setLimits({ jobRetentionDays: 33 })
    // Still the old value inside the window (unless this machine took most of the TTL to get here).
    const early = Date.now() - serverSavedAt < INSTANCE_CONFIG_TTL_MS - 10_000
    expect(early ? await serverView() : 21).toBe(21)
    await expect
      .poll(serverView, { timeout: INSTANCE_CONFIG_TTL_MS + 15_000, interval: 1_000 })
      .toBe(33)
    // Within the TTL after the server's last read, plus the polling interval and some slack.
    expect(Date.now() - serverSavedAt).toBeLessThan(INSTANCE_CONFIG_TTL_MS + 5_000)
  }, 90_000)
})
