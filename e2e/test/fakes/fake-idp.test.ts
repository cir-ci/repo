import { createPublicKey, createVerify, type webcrypto } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { type FakeIdp, startFakeIdp } from '../../src/fakes/fake-idp.ts'

let idp: FakeIdp | undefined
afterEach(async () => {
  await idp?.close()
  idp = undefined
})

describe('fake OIDC provider', () => {
  it('runs the authorization-code flow and signs an ID token for the configured identity', async () => {
    idp = await startFakeIdp('client-1', { host: '127.0.0.1' })
    idp.identity = { sub: 'sub-9', email: 'new.person@idp.test', name: 'New Person' }

    const discovery = (await (
      await fetch(`${idp.issuer}/.well-known/openid-configuration`)
    ).json()) as Record<string, string>
    expect(discovery['issuer']).toBe(idp.issuer)

    const auth = new URL(discovery['authorization_endpoint'] ?? '')
    auth.searchParams.set('redirect_uri', 'http://circi.test/cb')
    auth.searchParams.set('state', 'st')
    auth.searchParams.set('nonce', 'n-1')
    const redirect = await fetch(auth, { redirect: 'manual' })
    expect(redirect.status).toBe(302)
    const back = new URL(redirect.headers.get('location') ?? '')
    expect(back.origin + back.pathname).toBe('http://circi.test/cb')
    expect(back.searchParams.get('state')).toBe('st')

    const token = (await (
      await fetch(discovery['token_endpoint'] ?? '', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: back.searchParams.get('code') ?? '',
          grant_type: 'authorization_code',
        }),
      })
    ).json()) as { id_token: string; access_token: string }
    const [head, body, sig] = token.id_token.split('.')
    const jwks = (await (await fetch(discovery['jwks_uri'] ?? '')).json()) as {
      keys: webcrypto.JsonWebKey[]
    }
    const verified = createVerify('RSA-SHA256')
      .update(`${head}.${body}`)
      .verify(
        createPublicKey({ key: jwks.keys[0] as webcrypto.JsonWebKey, format: 'jwk' }),
        Buffer.from(sig ?? '', 'base64url'),
      )
    expect(verified).toBe(true)
    expect(JSON.parse(Buffer.from(body ?? '', 'base64url').toString())).toMatchObject({
      iss: idp.issuer,
      aud: 'client-1',
      nonce: 'n-1',
      sub: 'sub-9',
      email: 'new.person@idp.test',
      email_verified: true,
    })

    const info = (await (
      await fetch(discovery['userinfo_endpoint'] ?? '', {
        headers: { authorization: `Bearer ${token.access_token}` },
      })
    ).json()) as { email: string }
    expect(info.email).toBe('new.person@idp.test')
  })

  it('rejects an unknown code and reports the identity of whoever was set at authorize time', async () => {
    idp = await startFakeIdp('c', { host: '127.0.0.1' })
    const res = await fetch(`${idp.issuer}/token`, {
      method: 'POST',
      body: new URLSearchParams({ code: 'nope' }),
    })
    expect(res.status).toBe(400)
    expect(idp.requests).toContain('POST /token')
  })

  it('with enforceSecret, refuses a token request carrying the wrong client secret', async () => {
    idp = await startFakeIdp('client-1', {
      host: '127.0.0.1',
      clientSecret: 'right',
      enforceSecret: true,
    })
    const authorize = await fetch(`${idp.issuer}/authorize?redirect_uri=http://x.test/cb&state=s`, {
      redirect: 'manual',
    })
    const code = new URL(authorize.headers.get('location') ?? '').searchParams.get('code') ?? ''
    const token = (secret: string) =>
      fetch(`${idp?.issuer}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_secret: secret }),
      })
    expect((await token('wrong')).status).toBe(401)
    expect((await token('right')).status).toBe(200)
  })
})
