import { createHmac, createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  type CheckReport,
  GithubApiError,
  GithubApp,
  GithubInstallationRevokedError,
  verifyGithubSignature,
} from '../src/index.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

interface Call {
  method: string
  path: string
  auth: string | null
  body: unknown
}

/** A tiny fake GitHub: records calls, answers from a script keyed by "METHOD path". */
function fakeGithub(script: Record<string, unknown[]>) {
  const calls: Call[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const key = `${req.method} ${url.pathname}${url.search}`
    calls.push({
      method: req.method,
      path: url.pathname + url.search,
      auth: req.headers.get('authorization'),
      body: req.body ? JSON.parse(await req.text()) : undefined,
    })
    const next = script[key]?.shift()
    if (next === undefined) return new Response('{"message":"unscripted"}', { status: 500 })
    if (next instanceof Response) return next
    return Response.json(next)
  }
  return { calls, fetcher }
}

const report: CheckReport = {
  name: 'CirCI / default',
  status: 'completed',
  conclusion: 'action_required',
  title: '3 changed: review required',
  summary: 'details',
  actions: [{ identifier: 'approve', label: 'Approve', description: 'Accept these changes' }],
}

const tokenReply = {
  token: 'ghs_install',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
}

function appWith(script: Record<string, unknown[]>) {
  const fake = fakeGithub(script)
  const app = new GithubApp({
    apiUrl: 'https://api.github.test',
    appId: '4242',
    privateKey,
    fetch: fake.fetcher,
  })
  return { app, ...fake }
}

describe('verifyGithubSignature', () => {
  const body = '{"zen":"hi"}'
  const sign = (secret: string) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts the right signature only', () => {
    expect(verifyGithubSignature('s3cret', body, sign('s3cret'))).toBe(true)
    expect(verifyGithubSignature('s3cret', body, sign('other'))).toBe(false)
    expect(verifyGithubSignature('s3cret', `${body} `, sign('s3cret'))).toBe(false)
    expect(verifyGithubSignature('s3cret', body, undefined)).toBe(false)
    expect(verifyGithubSignature('s3cret', body, 'sha256=nothex')).toBe(false)
    expect(verifyGithubSignature('s3cret', body, 'sha1=abc')).toBe(false)
  })
})

describe('GithubApp', () => {
  it('signs a JWT GitHub can verify, naming the app', () => {
    const { app } = appWith({})
    const [h, p, s] = app.appJwt().split('.')
    const claims = JSON.parse(Buffer.from(p ?? '', 'base64url').toString())
    expect(claims.iss).toBe('4242')
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${p}`)
      .verify(createPublicKey(publicKey), Buffer.from(s ?? '', 'base64url'))
    expect(ok).toBe(true)
  })

  it('creates a check run with buttons, authenticated as the installation, token cached', async () => {
    const { app, calls } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply],
      'POST /repos/acme/web/check-runs': [{ id: 555 }, { id: 556 }],
    })
    const id = await app.upsertCheckRun('99', 'acme/web', {
      sha: 'abc1234',
      report,
      detailsUrl: 'https://ci/x',
    })
    expect(id).toBe('555')
    expect(calls[0]?.auth).toMatch(/^Bearer ey/) // the app's JWT, to get a token
    const create = calls[1]
    expect(create?.auth).toBe('Bearer ghs_install')
    expect(create?.body).toMatchObject({
      name: 'CirCI / default',
      head_sha: 'abc1234',
      status: 'completed',
      conclusion: 'action_required',
      details_url: 'https://ci/x',
      output: { title: '3 changed: review required', summary: 'details' },
      actions: [{ identifier: 'approve', label: 'Approve', description: 'Accept these changes' }],
    })
    await app.upsertCheckRun('99', 'acme/web', {
      sha: 'abc1234',
      report,
      detailsUrl: 'https://ci/x',
    })
    expect(calls.filter((c) => c.path.includes('access_tokens'))).toHaveLength(1)
  })

  it('updates an existing check run instead of creating another', async () => {
    const { app, calls } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply],
      'PATCH /repos/acme/web/check-runs/555': [{ id: 555 }],
    })
    await app.upsertCheckRun('99', 'acme/web', {
      sha: 'abc1234',
      report: { ...report, status: 'in_progress' },
      detailsUrl: 'https://ci/x',
      existingId: '555',
    })
    expect(calls[1]?.method).toBe('PATCH')
    expect(calls[1]?.body).not.toHaveProperty('conclusion')
    expect(calls[1]?.body).not.toHaveProperty('head_sha')
  })

  it('finds its comment by the marker, edits it, and recreates it if it was deleted', async () => {
    const marked = { id: 77, body: '<!-- circi:pr-summary -->\nold' }
    const { app, calls } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply],
      'GET /repos/acme/web/issues/12/comments?per_page=100': [[{ id: 1, body: 'lgtm' }, marked]],
      'PATCH /repos/acme/web/issues/comments/77': [
        new Response('{"message":"Not Found"}', { status: 404 }),
      ],
      'POST /repos/acme/web/issues/12/comments': [{ id: 78 }],
    })
    const id = await app.upsertComment('99', 'acme/web', 12, 'new body')
    expect(id).toBe('78')
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /app/installations/99/access_tokens',
      'GET /repos/acme/web/issues/12/comments?per_page=100',
      'PATCH /repos/acme/web/issues/comments/77',
      'POST /repos/acme/web/issues/12/comments',
    ])
  })

  it('edits a known comment id without listing', async () => {
    const { app, calls } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply],
      'PATCH /repos/acme/web/issues/comments/77': [{ id: 77 }],
    })
    expect(await app.upsertComment('99', 'acme/web', 12, 'b', '77')).toBe('77')
    expect(calls).toHaveLength(2)
  })

  it('surfaces GitHub errors with their message', async () => {
    const { app } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply],
      'POST /repos/acme/web/check-runs': [
        new Response('{"message":"Resource not accessible by integration"}', { status: 403 }),
      ],
    })
    await expect(
      app.upsertCheckRun('99', 'acme/web', { sha: 'a', report, detailsUrl: 'u' }),
    ).rejects.toThrow(GithubApiError)
  })

  it('drops a cached token GitHub rejects with 401 and retries once with a fresh one', async () => {
    const { app, calls } = appWith({
      'POST /app/installations/99/access_tokens': [
        tokenReply,
        { token: 'ghs_second', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
      ],
      'POST /repos/acme/web/check-runs': [
        new Response('{"message":"Bad credentials"}', { status: 401 }),
        { id: 5 },
      ],
    })
    const id = await app.upsertCheckRun('99', 'acme/web', { sha: 'a', report, detailsUrl: 'u' })
    expect(id).toBe('5')
    const runs = calls.filter((c) => c.path === '/repos/acme/web/check-runs')
    expect(runs).toHaveLength(2)
    expect(runs[1]?.auth).toBe('Bearer ghs_second')
    // A 401 that persists is surfaced, not retried forever.
    const { app: again } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply, tokenReply],
      'POST /repos/acme/web/check-runs': [
        new Response('{"message":"Bad credentials"}', { status: 401 }),
        new Response('{"message":"Bad credentials"}', { status: 401 }),
      ],
    })
    await expect(
      again.upsertCheckRun('99', 'acme/web', { sha: 'a', report, detailsUrl: 'u' }),
    ).rejects.toBeInstanceOf(GithubInstallationRevokedError)
  })

  it('treats a 401 or 404 when minting the installation token as a revoked installation', async () => {
    for (const status of [401, 404]) {
      const { app, calls } = appWith({
        'POST /app/installations/99/access_tokens': [
          new Response('{"message":"Not Found"}', { status }),
        ],
      })
      // oxlint-disable-next-line no-await-in-loop -- two independent apps, one after the other
      const err = await app
        .upsertCheckRun('99', 'acme/web', { sha: 'a', report, detailsUrl: 'u' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(GithubInstallationRevokedError)
      expect(err).toMatchObject({ installationId: '99', status })
      expect(calls).toHaveLength(1)
    }
    const suspended = appWith({
      'POST /app/installations/99/access_tokens': [
        new Response('{"message":"This GitHub App installation has been suspended."}', {
          status: 403,
        }),
      ],
    }).app
    await expect(
      suspended.upsertCheckRun('99', 'acme/web', { sha: 'a', report, detailsUrl: 'u' }),
    ).rejects.toBeInstanceOf(GithubInstallationRevokedError)
  })

  it('does not call a 404 on a repository, or a 5xx, a revoked installation', async () => {
    const { app } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply],
      'POST /repos/acme/web/check-runs': [new Response('{"message":"Not Found"}', { status: 404 })],
    })
    const err = await app
      .upsertCheckRun('99', 'acme/web', { sha: 'a', report, detailsUrl: 'u' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GithubApiError)
    expect(err).not.toBeInstanceOf(GithubInstallationRevokedError)
    const { app: flaky } = appWith({
      'POST /app/installations/99/access_tokens': [new Response('{}', { status: 502 })],
    })
    const err2 = await flaky
      .upsertCheckRun('99', 'acme/web', { sha: 'a', report, detailsUrl: 'u' })
      .catch((e: unknown) => e)
    expect(err2).not.toBeInstanceOf(GithubInstallationRevokedError)
  })

  it('canWrite surfaces a revoked installation instead of answering false', async () => {
    const { app } = appWith({
      'POST /app/installations/99/access_tokens': [new Response('{}', { status: 404 })],
    })
    await expect(app.canWrite('99', 'acme/web', 'ann')).rejects.toBeInstanceOf(
      GithubInstallationRevokedError,
    )
  })

  it('knows who has write access', async () => {
    const { app } = appWith({
      'POST /app/installations/99/access_tokens': [tokenReply],
      'GET /repos/acme/web/collaborators/ann/permission': [{ permission: 'write' }],
      'GET /repos/acme/web/collaborators/bob/permission': [{ permission: 'read' }],
      'GET /repos/acme/web/collaborators/eve/permission': [
        new Response('{"message":"Not Found"}', { status: 404 }),
      ],
    })
    expect(await app.canWrite('99', 'acme/web', 'ann')).toBe(true)
    expect(await app.canWrite('99', 'acme/web', 'bob')).toBe(false)
    expect(await app.canWrite('99', 'acme/web', 'eve')).toBe(false)
  })
})
