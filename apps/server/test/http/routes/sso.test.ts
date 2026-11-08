import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { callbackUrl, createAuth } from '@circi/auth'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { ORIGIN } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let idp: Server

function portOf(server: Server): number {
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('server is not listening')
  return address.port
}
let issuer = ''

beforeAll(async () => {
  // A stand-in identity provider: better-auth fetches its discovery document at startup.
  idp = createServer((req, res) => {
    const base = `http://127.0.0.1:${portOf(idp)}`
    res.setHeader('content-type', 'application/json')
    res.end(
      req.url === '/.well-known/openid-configuration'
        ? JSON.stringify({
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            userinfo_endpoint: `${base}/userinfo`,
            jwks_uri: `${base}/jwks`,
          })
        : '{}',
    )
  })
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${portOf(idp)}`
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-sso-'))
  const sso = [
    {
      id: 'github' as const,
      name: 'GitHub',
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
      trustedForEmail: true,
    },
    {
      id: 'oidc' as const,
      name: 'Acme SSO',
      clientId: 'oidc-id',
      clientSecret: 'oidc-secret',
      issuer,
      trustedForEmail: false,
    },
  ]
  const auth = createAuth({
    db: t.db,
    secret: 'test-secret-that-is-long-enough-1234',
    baseURL: ORIGIN,
    sso,
  })
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: dir }),
      publicOrigin: ORIGIN,
      sso: [
        { id: 'github', name: 'GitHub' },
        { id: 'oidc', name: 'Acme SSO' },
      ],
    },
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await new Promise((resolve) => idp.close(resolve))
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

describe('single sign-on wiring', () => {
  it('offers the configured providers to the sign-in page', async () => {
    const res = await app.inject({ url: '/api/auth-methods' })
    expect(res.json().sso).toEqual([
      { id: 'github', name: 'GitHub' },
      { id: 'oidc', name: 'Acme SSO' },
    ])
  })

  it('sends the browser to the provider with the callback on the dashboard address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ provider: 'github', callbackURL: '/' }),
    })
    expect(res.statusCode).toBe(200)
    const url = new URL(res.json().url)
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('gh-id')
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/github`)
  })

  it('reaches a generic OpenID Connect provider through its discovery document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ provider: 'oidc', callbackURL: '/' }),
    })
    expect(res.statusCode).toBe(200)
    const url = new URL(res.json().url)
    expect(url.origin + url.pathname).toBe(`${issuer}/authorize`)
    expect(url.searchParams.get('client_id')).toBe('oidc-id')
    expect(url.searchParams.get('redirect_uri')).toBe(callbackUrl(ORIGIN, { id: 'oidc' }))
    expect(url.searchParams.get('code_challenge')).toBeTruthy() // PKCE
  })
})
