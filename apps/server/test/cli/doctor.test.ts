import { createServer } from 'node:net'
import { tmpdir } from 'node:os'

import { loadConfig } from '@circi/config'
import { createStorage } from '@circi/storage'
import { fakeMailer } from '@circi/testing'
import { describe, expect, it } from 'vitest'

import { domainCookies, parentDomain, runDoctor } from '#composition/doctor.ts'

const base = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-123',
  PUBLIC_URL: 'https://ci.acme.io',
  STATIC_SITES_HOST: 'acme-sites.com',
}

const answers =
  (table: Record<string, { status: number; setCookies: string[] } | undefined>) =>
  async (url: string) =>
    table[new URL(url).hostname]

const none = async () => undefined

const byId = (out: runDoctor.Finding[], id: string) => out.find((f) => f.id === id)
const disk = (free: number, total: number) => async () => ({ free, total })

describe('doctor', () => {
  it('finds parent domains and domain-wide cookies', () => {
    expect(parentDomain('ci.acme.io')).toBe('acme.io')
    expect(parentDomain('acme.io')).toBeUndefined()
    expect(
      domainCookies(['a=1; Path=/', 'b=2; Domain=acme.io; Path=/', 'c=3; domain=.acme.io']),
    ).toEqual(['b', 'c'])
  })

  it('is satisfied by a clean setup, and always ends with the reminder', async () => {
    const out = await runDoctor(
      loadConfig(base),
      answers({
        'acme.io': { status: 200, setCookies: ['a=1; Path=/'] },
        'www.acme.io': { status: 200, setCookies: [] },
        'acme-sites.com': { status: 404, setCookies: [] },
      }),
    )
    expect(out.filter((f) => f.level === 'warn')).toEqual([])
    expect(out.at(-1)?.message).toContain('only sees the hosts above')
    // With hosting on, it points at the Caddy setup custom domains need.
    expect(out.find((f) => f.id === 'custom-domains')?.message).toContain('/internal/tls-ask')
  })

  it('warns about a parent domain that sets cookies for the whole domain', async () => {
    const out = await runDoctor(
      loadConfig(base),
      answers({
        'acme.io': { status: 200, setCookies: ['tracker=1; Domain=acme.io'] },
        'www.acme.io': undefined,
        'acme-sites.com': { status: 404, setCookies: [] },
      }),
    )
    expect(out.find((f) => f.level === 'warn')).toMatchObject({
      id: 'host:acme.io',
      label: 'Cookies on acme.io',
      detail: expect.stringContaining('Sets cookies for a whole domain'),
      value: 'acme.io sets tracker with a Domain attribute',
    })
    expect(byId(out, 'host:www.acme.io')).toMatchObject({
      level: 'info',
      label: 'Cookies on www.acme.io',
      value: 'www.acme.io',
    })
    expect(byId(out, 'host:www.acme.io')?.detail).toContain('Could not be reached')
  })

  it('warns when the sites domain serves content or sets any domain cookie', async () => {
    const served = await runDoctor(
      loadConfig(base),
      answers({
        'acme.io': { status: 404, setCookies: [] },
        'www.acme.io': { status: 404, setCookies: [] },
        'acme-sites.com': { status: 200, setCookies: [] },
      }),
    )
    expect(served.find((f) => f.level === 'warn')?.message).toContain('must serve nothing but')
    const cookie = await runDoctor(
      loadConfig(base),
      answers({
        'acme.io': { status: 404, setCookies: [] },
        'www.acme.io': { status: 404, setCookies: [] },
        'acme-sites.com': { status: 404, setCookies: ['x=1; Domain=acme-sites.com'] },
      }),
    )
    expect(cookie.find((f) => f.level === 'warn')?.message).toContain(
      'sites domain must never set cookies',
    )
  })

  it('warns about a plain-http dashboard, and says when hosting is off', async () => {
    const out = await runDoctor(
      loadConfig({ ...base, PUBLIC_URL: 'http://ci.acme.io', STATIC_SITES_HOST: '' }),
      answers({}),
    )
    expect(out.some((f) => f.level === 'warn' && f.message.includes('plain http'))).toBe(true)
    expect(byId(out, 'static-sites')).toMatchObject({
      label: 'Static sites',
      detail: 'Hosting is off.',
    })
    expect(out.some((f) => f.id === 'custom-domains')).toBe(false)
  })

  it('reports an unusable storage as failing with the reason, and a good one as ok', async () => {
    const config = loadConfig(base)
    const bad = await runDoctor(config, none, {
      kind: 's3',
      healthCheck: () => Promise.reject(new Error('S3 bucket "x" does not exist')),
    })
    expect(byId(bad, 'storage')).toMatchObject({ level: 'fail', label: 'Storage' })
    expect(byId(bad, 'storage')?.detail).toContain('does not exist')
    const good = await runDoctor(config, none, { kind: 'fs', healthCheck: async () => {} })
    expect(byId(good, 'storage')).toMatchObject({
      level: 'ok',
      label: 'Storage',
      detail: 'Reachable and writable.',
    })
  })

  it('says clearly that an S3 that never answers timed out', async () => {
    const sockets: { destroy(): void }[] = []
    const silent = createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => {})
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const address = silent.address()
    if (address === null || typeof address === 'string') throw new Error('not listening')
    const port = address.port
    try {
      const storage = createStorage({
        driver: 's3',
        bucket: 'circi',
        region: 'us-east-1',
        endpoint: `http://127.0.0.1:${port}`,
        forcePathStyle: true,
        credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
        connectTimeoutMs: 200,
        requestTimeoutMs: 200,
      })
      const out = await runDoctor(loadConfig(base), none, storage)
      const failed = byId(out, 'storage')
      expect(failed?.level).toBe('fail')
      expect(failed?.detail).toContain('did not answer in time')
      expect(failed?.detail).toContain('S3_REQUEST_TIMEOUT_SECONDS')
    } finally {
      for (const s of sockets) s.destroy()
      await new Promise((resolve) => silent.close(resolve))
    }
  })

  describe('mail, database and disk', () => {
    const GB = 1024 ** 3
    const smtp = { ...base, SMTP_HOST: 'smtp.acme.test', SMTP_FROM: 'ci@acme.test' }
    const dbOk = { ping: async () => {}, migrations: async () => ({ applied: 3, available: 3 }) }

    it('verifies SMTP through the mailer without sending, and says why when it fails', async () => {
      const mailer = fakeMailer()
      const ok = await runDoctor(loadConfig(smtp), none, undefined, { mailer })
      expect(byId(ok, 'mail')?.level).toBe('ok')
      expect(mailer.verified).toBe(1)
      expect(mailer.sent).toEqual([])
      mailer.verifyError = new Error('Invalid login: 535 authentication failed')
      const bad = await runDoctor(loadConfig(smtp), none, undefined, { mailer })
      expect(byId(bad, 'mail')).toMatchObject({ level: 'fail', label: 'Mail' })
      expect(byId(bad, 'mail')?.message).toContain('535 authentication failed')
      expect(mailer.sent).toEqual([])
    })

    it('notes mail that is off or could not be tested, and runs no check without probes', async () => {
      const off = await runDoctor(loadConfig(base), none, undefined, {})
      expect(byId(off, 'mail')).toMatchObject({ level: 'info' })
      expect(byId(off, 'mail')?.message).toContain('SMTP_HOST is not set')
      const untested = await runDoctor(loadConfig(smtp), none, undefined, { mailer: {} })
      expect(byId(untested, 'mail')?.message).toContain('not tested')
      const plain = await runDoctor(loadConfig(smtp), none)
      expect(byId(plain, 'mail')).toBeUndefined()
    })

    it('pings the database and compares applied migrations with those shipped', async () => {
      const ok = await runDoctor(loadConfig(base), none, undefined, { database: dbOk })
      expect(byId(ok, 'database')).toMatchObject({ level: 'ok' })
      // Structured: a label, what was found and the fact behind it (the CLI prints them as one line).
      expect(byId(ok, 'database')).toMatchObject({
        label: 'Database',
        detail: 'Reachable. Migrations are current.',
        value: '3 migrations',
        message: 'Database: Reachable. Migrations are current. (3 migrations)',
      })
      const behind = await runDoctor(loadConfig(base), none, undefined, {
        database: { ...dbOk, migrations: async () => ({ applied: 2, available: 3 }) },
      })
      expect(byId(behind, 'database')?.detail).toContain('only 2 of 3 migrations')
      expect(byId(behind, 'database')?.value).toBe('2 of 3 migrations')
      expect(byId(behind, 'database')?.level).toBe('fail')
      const ahead = await runDoctor(loadConfig(base), none, undefined, {
        database: { ...dbOk, migrations: async () => ({ applied: 4, available: 3 }) },
      })
      expect(byId(ahead, 'database')?.message).toContain('newer version')
      const down = await runDoctor(loadConfig(base), none, undefined, {
        database: {
          ping: () => Promise.reject(new Error('ECONNREFUSED')),
          migrations: async () => ({ applied: 0, available: 3 }),
        },
      })
      expect(byId(down, 'database')).toMatchObject({ level: 'fail' })
      expect(byId(down, 'database')?.message).toContain('ECONNREFUSED')
    })

    it('warns below 10% or 2 GB of free disk at the storage path, and skips S3', async () => {
      const fs = loadConfig(base)
      const roomy = await runDoctor(fs, none, undefined, { diskSpace: disk(100 * GB, 500 * GB) })
      expect(byId(roomy, 'disk')?.level).toBe('ok')
      const tenth = await runDoctor(fs, none, undefined, { diskSpace: disk(40 * GB, 500 * GB) })
      expect(byId(tenth, 'disk')?.level).toBe('warn')
      const small = await runDoctor(fs, none, undefined, { diskSpace: disk(1 * GB, 8 * GB) })
      expect(byId(small, 'disk')?.level).toBe('warn')
      const smallOk = await runDoctor(fs, none, undefined, { diskSpace: disk(5 * GB, 20 * GB) })
      expect(byId(smallOk, 'disk')?.level).toBe('ok')
      const unreadable = await runDoctor(fs, none, undefined, {
        diskSpace: () => Promise.reject(new Error('ENOENT')),
      })
      expect(byId(unreadable, 'disk')?.message).toContain('ENOENT')
      const s3 = loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'circi' })
      const skipped = await runDoctor(s3, none, undefined, { diskSpace: disk(0, GB) })
      expect(byId(skipped, 'disk')).toBeUndefined()
    })

    it('reads real free space with statfs', async () => {
      const real = await runDoctor(
        loadConfig({ ...base, STORAGE_PATH: tmpdir() }),
        none,
        undefined,
        {},
      )
      expect(['ok', 'warn']).toContain(byId(real, 'disk')?.level)
      expect(byId(real, 'disk')?.message).toContain(tmpdir())
    })
  })
})
