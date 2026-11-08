import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

/**
 * A stand-in OpenID Connect provider for tests: discovery, authorize (which signs "whoever is
 * set in `identity`" in immediately), token with a signed ID token, userinfo and JWKS.
 */
export interface FakeIdp {
  issuer: string
  /** Who the next login signs in as. */
  identity: { sub: string; email: string; name: string; email_verified?: boolean }
  close(): Promise<void>
}

const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url')

export async function startFakeIdp(clientId: string): Promise<FakeIdp> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'k1',
    alg: 'RS256',
    use: 'sig',
  }
  const codes = new Map<string, { nonce: string | null; identity: FakeIdp['identity'] }>()
  const state = { identity: { sub: 'u-1', email: 'x@idp.test', name: 'X' } as FakeIdp['identity'] }
  let server!: Server
  const base = () => {
    const a = server.address()
    if (typeof a !== 'object' || a === null) throw new Error('not listening')
    return `http://127.0.0.1:${a.port}`
  }
  const idToken = (claims: Record<string, unknown>) => {
    const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }))
    const body = b64(JSON.stringify(claims))
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey)
    return `${head}.${body}.${b64(sig)}`
  }

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', base())
    const json = (data: unknown) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(data))
    }
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: base(),
        authorization_endpoint: `${base()}/authorize`,
        token_endpoint: `${base()}/token`,
        userinfo_endpoint: `${base()}/userinfo`,
        jwks_uri: `${base()}/jwks`,
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/authorize') {
      const code = randomBytes(8).toString('hex')
      codes.set(code, { nonce: url.searchParams.get('nonce'), identity: state.identity })
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
        const code = new URLSearchParams(raw).get('code') ?? ''
        const entry = codes.get(code)
        if (!entry) {
          res.statusCode = 400
          return json({ error: 'invalid_grant' })
        }
        const now = Math.floor(Date.now() / 1000)
        json({
          access_token: `at-${code}`,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken({
            iss: base(),
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    issuer: base(),
    get identity() {
      return state.identity
    },
    set identity(value) {
      state.identity = value
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
