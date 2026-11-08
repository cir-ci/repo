import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto'

import { listen } from './http.ts'

/**
 * A stand-in OpenID Connect provider: discovery, authorize (which signs "whoever is set in
 * `identity`" in immediately, no login page), token with a signed ID token, userinfo and JWKS.
 * Adapted from apps/server/test/support/fake-idp.ts (another package's test folder can't be
 * imported); the difference is the host name in the issuer, which must work from the circi
 * container and from the browser: `host.docker.internal` (default).
 */
export interface FakeIdp {
  /** The issuer URL: set `AUTH_OIDC_ISSUER` / the workspace SSO provider to this. */
  issuer: string
  port: number
  /** Who the next login signs in as. */
  identity: Identity
  /** Every request the provider received: `"GET /jwks"`. */
  requests: string[]
  close(): Promise<void>
}

export interface Identity {
  sub: string
  email: string
  name: string
  email_verified?: boolean
}

const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url')

export async function startFakeIdp(
  clientId: string,
  options: { host?: string; clientSecret?: string; enforceSecret?: boolean } = {},
): Promise<FakeIdp> {
  const host = options.host ?? 'host.docker.internal'
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, { nonce: string | null; identity: Identity }>()
  const requests: string[] = []
  const state = { identity: { sub: 'u-1', email: 'x@idp.test', name: 'X' } as Identity }
  let base = ''

  const idToken = (claims: Record<string, unknown>) => {
    const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }))
    const body = b64(JSON.stringify(claims))
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey)
    return `${head}.${body}.${b64(sig)}`
  }

  const listening = await listen((req, res) => {
    const url = new URL(req.url ?? '/', 'http://idp.invalid')
    requests.push(`${req.method} ${url.pathname}`)
    const json = (data: unknown, status = 200) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(data))
    }
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        userinfo_endpoint: `${base}/userinfo`,
        jwks_uri: `${base}/jwks`,
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/authorize') {
      const code = randomBytes(8).toString('hex')
      codes.set(code, { nonce: url.searchParams.get('nonce'), identity: { ...state.identity } })
      const back = new URL(url.searchParams.get('redirect_uri') ?? '')
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      res.statusCode = 302
      res.setHeader('location', back.toString())
      return res.end()
    }
    if (url.pathname === '/token') {
      let raw = ''
      req.on('data', (c) => (raw += String(c)))
      req.on('end', () => {
        const params = new URLSearchParams(raw)
        if (options.enforceSecret) {
          // `enforceSecret`: refuse a token request whose secret is not `clientSecret`, like a real provider.
          const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? '')?.[1]
          const fromBasic = basic
            ? decodeURIComponent(
                Buffer.from(basic, 'base64').toString().split(':').slice(1).join(':'),
              )
            : undefined
          const given = params.get('client_secret') ?? fromBasic
          if (given !== options.clientSecret) return json({ error: 'invalid_client' }, 401)
        }
        const entry = codes.get(params.get('code') ?? '')
        if (!entry) return json({ error: 'invalid_grant' }, 400)
        const now = Math.floor(Date.now() / 1000)
        json({
          access_token: `at-${params.get('code')}`,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken({
            iss: base,
            aud: clientId,
            iat: now,
            exp: now + 600,
            ...(entry.nonce ? { nonce: entry.nonce } : {}),
            ...entry.identity,
            email_verified: entry.identity.email_verified ?? true,
          }),
        })
      })
      return undefined
    }
    if (url.pathname === '/userinfo') {
      const token = (req.headers.authorization ?? '').replace('Bearer at-', '')
      const entry = codes.get(token)
      return json({
        ...(entry?.identity ?? state.identity),
        email_verified: entry?.identity.email_verified ?? true,
      })
    }
    res.statusCode = 404
    return res.end()
  })
  base = `http://${host}:${listening.port}`

  return {
    issuer: base,
    port: listening.port,
    requests,
    get identity() {
      return state.identity
    },
    set identity(value) {
      state.identity = value
    },
    close: () => listening.close(),
  }
}
