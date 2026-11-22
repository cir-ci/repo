import { resolve } from 'node:path'

import { setupCode } from '@circi/auth'
import { loadConfig } from '@circi/config'
import { createTestDb, seedWorkspace } from '@circi/db/testing'
import { createInstanceConfig } from '@circi/services'
import { fakeTimers, TEST_AUTH_SECRET } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { instanceEnvOf } from '#composition/instance-env.ts'
import { serverOptionsFor, type ServerRuntime } from '#composition/server-options.ts'
import { webDistPath } from '#composition/services.ts'
import { createShutdown } from '#composition/shutdown.ts'
import { announceStartup } from '#composition/startup.ts'

const env = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
  PUBLIC_URL: 'https://ci.acme.io',
}

function capturingLogger() {
  const warnings: string[] = []
  const logger = {
    warn: (...args: unknown[]) =>
      warnings.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
    info: () => {},
    error: () => {},
  }
  // Only the methods used are needed; the rest of pino's surface is irrelevant here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { logger: logger as never, warnings }
}

describe('announceStartup', () => {
  let t: createTestDb.Result
  beforeAll(async () => {
    t = await createTestDb()
  })
  afterAll(async () => {
    await t.close()
  })

  it('prints the setup code while there are no accounts, and stops once there is one', async () => {
    const config = loadConfig(env)
    const first = capturingLogger()
    await announceStartup({ db: { db: t.db }, config, logger: first.logger }, { http: true })
    expect(first.warnings.some((w) => w.includes(setupCode(config.authSecret)))).toBe(true)

    await seedWorkspace(t.db)
    const second = capturingLogger()
    await announceStartup({ db: { db: t.db }, config, logger: second.logger }, { http: true })
    expect(second.warnings.some((w) => w.includes('setup code'))).toBe(false)
  })

  it('stays quiet about setup for a worker-only process', async () => {
    const fresh = await createTestDb()
    const out = capturingLogger()
    await announceStartup(
      { db: { db: fresh.db }, config: loadConfig(env), logger: out.logger },
      { http: false },
    )
    expect(out.warnings).toEqual([])
    await fresh.close()
  })

  it('warns once when the dashboard address changed, with the checklist', async () => {
    const fresh = await createTestDb()
    const rt = (origin: string) => ({
      db: { db: fresh.db },
      config: loadConfig({ ...env, PUBLIC_URL: origin }),
      logger: capturingLogger(),
    })
    const a = rt('https://old.acme.io')
    await announceStartup({ ...a, logger: a.logger.logger }, { http: false })
    expect(a.logger.warnings).toEqual([])
    const b = rt('https://new.acme.io')
    await announceStartup({ ...b, logger: b.logger.logger }, { http: false })
    expect(b.logger.warnings[0]).toContain('https://old.acme.io')
    expect(b.logger.warnings[0]).toContain('checklist')
    const c = rt('https://new.acme.io')
    await announceStartup({ ...c, logger: c.logger.logger }, { http: false })
    expect(c.logger.warnings).toEqual([])
    await fresh.close()
  })
})

describe('createShutdown', () => {
  const quiet = { info: () => {}, error: () => {} }

  it('closes everything and exits 0', async () => {
    const exit = vi.fn<(code: number) => void>()
    const close = vi.fn<() => Promise<void>>(async () => {})
    await createShutdown({ logger: quiet, close, exit })('SIGTERM')
    expect(close).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 when closing fails', async () => {
    const exit = vi.fn<(code: number) => void>()
    await createShutdown({
      logger: quiet,
      close: async () => {
        throw new Error('db gone')
      },
      exit,
    })('SIGINT')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('ignores a second signal while shutting down', async () => {
    const exit = vi.fn<(code: number) => void>()
    const close = vi.fn<() => Promise<void>>(async () => {})
    const shutdown = createShutdown({ logger: quiet, close, exit })
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')])
    expect(close).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
  })

  it('gives up and exits 1 when closing hangs', async () => {
    const clock = fakeTimers()
    const exit = vi.fn<(code: number) => void>()
    const hung = createShutdown({
      logger: quiet,
      close: () => new Promise(() => {}),
      exit,
      timeoutMs: 50,
    })('SIGTERM')
    await clock.advance(60)
    expect(exit).toHaveBeenCalledWith(1)
    void hung
  })
})

const runtimeWith = (extra: Record<string, string> = {}): ServerRuntime => {
  // Nothing in the fakes is called while the options are being built.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const fake = {
    logger: {},
    db: { db: {}, ping: async () => {} },
    auth: {},
    storage: { healthCheck: async () => {} },
  } as never as Omit<ServerRuntime, 'config'>
  const config = loadConfig({ ...env, ...extra })
  // Its database is a fake that fails every read, so it answers with the environment's values.
  const instanceConfig = createInstanceConfig({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    db: {} as never,
    authSecret: config.authSecret,
    env: instanceEnvOf(config),
  })
  return { ...fake, config, instanceConfig }
}

describe('serverOptionsFor', () => {
  it('wires the dashboard address and the configured sign-in methods through', async () => {
    const o = serverOptionsFor(
      runtimeWith({
        AUTH_PASSWORD_ENABLED: 'false',
        AUTH_GITHUB_CLIENT_ID: 'i',
        AUTH_GITHUB_CLIENT_SECRET: 's',
      }),
      '/web',
    )
    expect(o.publicOrigin).toBe('https://ci.acme.io')
    expect(o.dashboard).toMatchObject({ webDist: '/web' })
    // Read per request from the instance settings; here the environment's values.
    const effective = await o.dashboard?.instanceConfig?.get()
    expect(effective).toMatchObject({
      workspaceCreation: 'admin',
      signIn: { password: false },
      sso: [{ id: 'github', name: 'GitHub' }],
    })
    expect(o.api?.githubApp).toBe(false)
    expect(o.gitWebhook?.integrations?.config.github).toBeUndefined()
    expect(o.checks.map((c) => c.name)).toEqual(['database', 'storage'])
  })

  it('gives the git webhook scope the GitHub App only when one is configured', () => {
    const o = serverOptionsFor(
      runtimeWith({
        GITHUB_APP_ID: '1',
        GITHUB_APP_PRIVATE_KEY: 'k',
        GITHUB_APP_WEBHOOK_SECRET: 'sec',
      }),
      '/web',
    )
    expect(o.gitWebhook?.integrations?.config.github?.webhookSecret).toBe('sec')
    expect(o.api?.githubApp).toBe(true)
    expect(o.dashboard?.githubApp).toBe(true)
  })

  it('passes old dashboard hosts for redirects', () => {
    const o = serverOptionsFor(runtimeWith({ PREVIOUS_PUBLIC_URLS: 'https://old.acme.io' }), '/web')
    expect(o.previousHosts).toEqual(['old.acme.io'])
  })
})

describe('webDistPath', () => {
  it('points at apps/web/dist, wherever this file sits in apps/server', () => {
    // test → apps/server → apps → web/dist
    expect(webDistPath({})).toBe(resolve(import.meta.dirname, '../../web/dist'))
  })

  it('can be overridden by config (CIRCI_WEB_DIST)', () => {
    expect(webDistPath({ webDist: '/srv/web' })).toBe('/srv/web')
  })
})
