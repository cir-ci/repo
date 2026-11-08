import { createServer } from 'node:net'

import { loadConfig } from '@circi/config'
import { createStorage } from '@circi/storage'
import { describe, expect, it } from 'vitest'

import { domainCookies, parentDomain, runDoctor } from '#lifecycle/doctor.ts'

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
    expect(out.find((f) => f.level === 'warn')?.message).toContain(
      'acme.io sets cookies for a whole domain (tracker)',
    )
    expect(out.some((f) => f.message.includes('www.acme.io: could not be reached'))).toBe(true)
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
    expect(out.some((f) => f.message.includes('Static site hosting is off'))).toBe(true)
  })

  it('reports an unusable storage as a warning with the reason, and a good one as ok', async () => {
    const config = loadConfig(base)
    const bad = await runDoctor(config, none, {
      kind: 's3',
      healthCheck: () => Promise.reject(new Error('S3 bucket "x" does not exist')),
    })
    expect(bad.find((f) => f.level === 'warn')?.message).toContain('does not exist')
    const good = await runDoctor(config, none, { kind: 'fs', healthCheck: async () => {} })
    expect(good.find((f) => f.message.includes('Storage (fs)'))?.level).toBe('ok')
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
      const warn = out.find((f) => f.level === 'warn')
      expect(warn?.message).toContain('did not answer in time')
      expect(warn?.message).toContain('S3_REQUEST_TIMEOUT_SECONDS')
    } finally {
      for (const s of sockets) s.destroy()
      await new Promise((resolve) => silent.close(resolve))
    }
  })
})
