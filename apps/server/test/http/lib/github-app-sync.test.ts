import type { IntegrationDefinition } from '@circi/integrations'
import { createTestDb } from '@circi/testing'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildServer } from '#http/app.ts'
import { githubAppSync, storeGithubApp } from '#http/lib/github-app.ts'

const SECRET = 'sync-test-secret-sync-test-secret'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const app = (id: string) => ({
  appId: id,
  slug: `circi-${id}`,
  clientId: 'Iv1.client',
  clientSecret: 'client-secret',
  htmlUrl: `https://github.com/apps/circi-${id}`,
  apiUrl: 'https://api.github.com',
  privateKey: `-----BEGIN PRIVATE KEY-----${id}-----END PRIVATE KEY-----`,
  webhookSecret: `whsec-${id}`,
})

/** A replica: its own live configuration and its own clock, over the shared database. */
function replica() {
  const config: IntegrationDefinition.InstanceConfig = {}
  const clock = { at: 1_000_000 }
  const sync = githubAppSync({
    db: t.db,
    authSecret: SECRET,
    config,
    ttlMs: 30_000,
    now: () => clock.at,
  })
  return { config, clock, sync }
}

describe('githubAppSync', () => {
  it('makes a second replica notice an App created and then changed by the first, without a restart', async () => {
    const writer = replica()
    const other = replica()
    expect(await other.sync.refresh()).toBe(false)
    expect(other.config.github).toBeUndefined()

    // The writer stores the App and invalidates its own cache, as the manifest callback does.
    await storeGithubApp(t.db, SECRET, app('1'))
    writer.sync.invalidate()
    expect(await writer.sync.refresh()).toBe(true)
    expect(writer.config.github).toMatchObject({ appId: '1', webhookSecret: 'whsec-1' })

    // The other replica still holds what it read: inside the TTL nothing is read.
    other.clock.at += 10_000
    expect(await other.sync.refresh()).toBe(false)
    expect(other.config.github).toBeUndefined()

    // After the TTL it notices the new App.
    other.clock.at += 25_000
    expect(await other.sync.refresh()).toBe(true)
    expect(other.config.github).toMatchObject({ appId: '1', webhookSecret: 'whsec-1' })
    const first = other.config.github

    // An unchanged setting changes nothing (same object, so caches keyed on it survive).
    other.clock.at += 31_000
    expect(await other.sync.refresh()).toBe(false)
    expect(other.config.github).toBe(first)

    // A changed App (re-created) is picked up the same way.
    await storeGithubApp(t.db, SECRET, app('2'))
    other.clock.at += 31_000
    expect(await other.sync.refresh()).toBe(true)
    expect(other.config.github).toMatchObject({ appId: '2', webhookSecret: 'whsec-2' })
    expect(other.config.github).not.toBe(first)
  })

  it('reads again at once after invalidate, however recent the last read', async () => {
    await storeGithubApp(t.db, SECRET, app('3'))
    const r = replica()
    expect(await r.sync.refresh()).toBe(true)
    await storeGithubApp(t.db, SECRET, app('4'))
    expect(await r.sync.refresh()).toBe(false)
    r.sync.invalidate()
    expect(await r.sync.refresh()).toBe(true)
    expect(r.config.github?.appId).toBe('4')
  })

  it('keeps the App it has when the setting cannot be read, and shares one read between callers', async () => {
    await storeGithubApp(t.db, SECRET, app('5'))
    const r = replica()
    await r.sync.refresh()
    // Sealed with another instance secret: unreadable, so the replica keeps App 5.
    await storeGithubApp(t.db, 'another-secret-another-secret-xx', app('6'))
    r.clock.at += 31_000
    expect(await r.sync.refresh()).toBe(false)
    expect(r.config.github?.appId).toBe('5')

    await storeGithubApp(t.db, SECRET, app('7'))
    r.clock.at += 31_000
    const results = await Promise.all([r.sync.refresh(), r.sync.refresh(), r.sync.refresh()])
    expect(results).toEqual([true, true, true])
    expect(r.config.github?.appId).toBe('7')
  })

  it('is refreshed before an HTTP request is handled', async () => {
    await storeGithubApp(t.db, SECRET, app('8'))
    const r = replica()
    const server = buildServer({
      logger: pino({ level: 'silent' }),
      checks: [],
      gitWebhook: {
        db: t.db,
        authSecret: SECRET,
        publicOrigin: 'https://ci.acme.test',
        integrations: {
          config: r.config,
          refresh: async () => void (await r.sync.refresh()),
        },
        logger: pino({ level: 'silent' }),
      },
    })
    await server.ready()
    expect(r.config.github).toBeUndefined()
    const res = await server.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    // The request did not wait for the read; the App is there shortly after.
    await vi.waitFor(() => expect(r.config.github?.appId).toBe('8'))
    await server.close()
  })

  it('does not stall a request on a slow read, and remembers a failed read for the TTL', async () => {
    const dead = await createTestDb()
    await dead.close()
    const config: IntegrationDefinition.InstanceConfig = {}
    const clock = { at: 1_000_000 }
    const sync = githubAppSync({
      db: dead.db,
      authSecret: SECRET,
      config,
      ttlMs: 30_000,
      now: () => clock.at,
    })
    await expect(sync.refresh()).rejects.toBeInstanceOf(Error)
    // Inside the TTL the failure is not asked again: no read, no error.
    expect(await sync.refresh()).toBe(false)
    clock.at += 31_000
    await expect(sync.refresh()).rejects.toBeInstanceOf(Error)

    const gate = Promise.withResolvers<void>()
    const slow = { refresh: () => gate.promise }
    const server = buildServer({
      logger: pino({ level: 'silent' }),
      checks: [],
      gitWebhook: {
        db: t.db,
        authSecret: SECRET,
        publicOrigin: 'https://ci.acme.test',
        integrations: { config, refresh: slow.refresh },
        logger: pino({ level: 'silent' }),
      },
    })
    await server.ready()
    const res = await server.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    gate.resolve()
    await server.close()
  })
})
