import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'

import { githubSignature } from '@circi/testing/hosts'

import { listen, readBody, sendJson, waitUntil } from './http.ts'

export namespace FakeGithub {
  export interface Request {
    method: string
    /** Path without the query string, e.g. `/repos/acme/web/check-runs`. */
    path: string
    query: Record<string, string>
    headers: Record<string, string | string[] | undefined>
    body: unknown
    /** `app` for the app JWT, `installation` for an installation token, `none`/`invalid` otherwise. */
    auth: 'app' | 'installation' | 'none' | 'invalid'
    at: Date
  }

  export interface CheckRun {
    id: number
    repo: string
    headSha: string
    name: string
    status: string
    conclusion: string | undefined
    title: string
    summary: string
    detailsUrl: string | undefined
    actions: { identifier: string; label: string; description: string }[]
    /** Every create/patch body, oldest first. */
    history: unknown[]
  }

  export interface Comment {
    id: number
    repo: string
    prNumber: number
    body: string
    reactions: string[]
  }
}

export interface FakeGithub {
  /** The address CirCI calls, from the container: set `GITHUB_API_URL` to this. */
  apiUrl: string
  port: number
  appId: string
  /** The app's private key (PEM), generated for this run: set `GITHUB_APP_PRIVATE_KEY`. */
  privateKey: string
  webhookSecret: string
  /** `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_API_URL` for the stack. */
  env(): Record<string, string>
  /** Every request, in order. */
  requests: FakeGithub.Request[]
  checkRuns: FakeGithub.CheckRun[]
  comments: FakeGithub.Comment[]
  /** `repo/login` -> permission (`admin`, `maintain`, `write`, `read`, `none`) for the collaborator check. */
  permissions: Map<string, string>
  setPermission(repo: string, login: string, permission: string): void
  /**
   * A code as GitHub hands it to the manifest redirect: `POST /app-manifests/<code>/conversions`
   * (no authentication) returns this fake's App credentials once, then 404s, as GitHub does.
   */
  issueManifestCode(): string
  /** The App's slug as the conversion and `GET /app` report it. */
  slug: string
  /** Answers the next `times` requests whose "METHOD /path" contains `match` with `status`. */
  failNext(match: string, status: number, times?: number): void
  /** Like `failNext`, with response headers (e.g. `retry-after`, `x-ratelimit-remaining`) and a message. */
  failNextWith(
    match: string,
    response: { status: number; headers?: Record<string, string>; message?: string },
    times?: number,
  ): void
  /** Holds the next `times` matching requests for `ms` before answering normally (a slow GitHub: the client's timeout). */
  delayNext(match: string, ms: number, times?: number): void
  /** Every installation token request for this installation answers 401 from now on (the app was uninstalled/revoked); `restoreInstallation` undoes it. */
  revokeInstallation(installationId: string): void
  restoreInstallation(installationId: string): void
  /** A comment written by a person on a pull request (so reactions and edits have something to hit). */
  seedComment(repo: string, prNumber: number, body: string): FakeGithub.Comment
  /** Every installation token handed out so far (to grep logs for leaks). */
  issuedTokens(): string[]
  /** Requests whose "METHOD path" contains `match`. */
  find(match: string): FakeGithub.Request[]
  waitForRequest(
    match: string,
    options?: { timeoutMs?: number; since?: number },
  ): Promise<FakeGithub.Request>
  /** A GitHub-signed webhook (`X-Hub-Signature-256`) to CirCI's `POST /webhooks/github`. */
  sendWebhook(
    circiUrl: string,
    event: string,
    payload: unknown,
    options?: { deliveryId?: string; secret?: string },
  ): Promise<{ status: number; body: string }>
  clear(): void
  /** Back to a fresh fake (requests, check runs, comments, permissions, scripted failures and delays, revoked installations) for the next test file when one fake serves several. */
  reset(): void
  close(): Promise<void>
}

const b64urlJson = (s: string) =>
  JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as unknown

/**
 * GitHub's REST API as far as `packages/providers/src/github.ts` uses it: installation tokens
 * (the app JWT is verified against this run's key pair), check runs, PR comments and reactions,
 * the collaborator permission, plus commit and statuses endpoints. Everything is recorded.
 */
export async function startFakeGithub(
  options: {
    host?: string
    appId?: string
    webhookSecret?: string
    /** GitHub Enterprise Server serves the API under `/api/v3`: the fake then answers only there and records paths without it. */
    pathPrefix?: string
  } = {},
): Promise<FakeGithub> {
  const appId = options.appId ?? '424242'
  const webhookSecret = options.webhookSecret ?? 'e2e-github-webhook-secret'
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const requests: FakeGithub.Request[] = []
  const checkRuns: FakeGithub.CheckRun[] = []
  const comments: FakeGithub.Comment[] = []
  const permissions = new Map<string, string>()
  const failures: {
    match: string
    status: number
    remaining: number
    headers?: Record<string, string>
    message?: string
  }[] = []
  const delays: { match: string; ms: number; remaining: number }[] = []
  const revoked = new Set<string>()
  const manifestCodes = new Set<string>()
  const slug = 'circi-e2e'
  let codeCounter = 0
  const prefix = (options.pathPrefix ?? '').replace(/\/$/, '')
  const tokens = new Set<string>()
  let nextId = 1000
  let tokenCounter = 0

  function authKind(header: string | undefined): FakeGithub.Request['auth'] {
    const token = header?.replace(/^Bearer\s+/i, '')
    if (!token) return 'none'
    if (tokens.has(token)) return 'installation'
    const parts = token.split('.')
    if (parts.length !== 3) return 'invalid'
    try {
      const head = b64urlJson(parts[0] ?? '') as { alg?: string }
      const claims = b64urlJson(parts[1] ?? '') as { iss?: string; exp?: number; iat?: number }
      const ok = createVerify('RSA-SHA256')
        .update(`${parts[0]}.${parts[1]}`)
        .verify(createPublicKey(publicKey), Buffer.from(parts[2] ?? '', 'base64url'))
      const now = Date.now() / 1000
      return head.alg === 'RS256' &&
        ok &&
        String(claims.iss) === appId &&
        typeof claims.exp === 'number' &&
        claims.exp > now &&
        claims.exp - (claims.iat ?? now) <= 600
        ? 'app'
        : 'invalid'
    } catch {
      return 'invalid'
    }
  }

  const listening = await listen((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://github.invalid')
      if (prefix) {
        if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
          return sendJson(res, 404, { message: `Not Found (expected the ${prefix} prefix)` })
        }
        url.pathname = url.pathname.slice(prefix.length) || '/'
      }
      const raw = (await readBody(req)).toString('utf8')
      let body: unknown
      try {
        body = raw ? JSON.parse(raw) : undefined
      } catch {
        body = raw
      }
      const method = req.method ?? 'GET'
      const auth = authKind(first(req.headers['authorization']))
      requests.push({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
        auth,
        at: new Date(),
      })
      const label = `${method} ${url.pathname}`
      const delay = delays.find((d) => d.remaining > 0 && label.includes(d.match))
      if (delay) {
        delay.remaining -= 1
        await new Promise((r) => setTimeout(r, delay.ms))
      }
      const failure = failures.find((f) => f.remaining > 0 && label.includes(f.match))
      if (failure) {
        failure.remaining -= 1
        for (const [k, v] of Object.entries(failure.headers ?? {})) res.setHeader(k, v)
        return sendJson(res, failure.status, { message: failure.message ?? 'failing on purpose' })
      }
      const revokedMatch = /^\/app\/installations\/([^/]+)\/access_tokens$/.exec(url.pathname)
      if (revokedMatch && revoked.has(revokedMatch[1] ?? '')) {
        return sendJson(res, 401, { message: 'Bad credentials (installation revoked)' })
      }
      const conversion = /^\/app-manifests\/([^/]+)\/conversions$/.exec(url.pathname)
      if (conversion && method === 'POST') {
        const code = decodeURIComponent(conversion[1] ?? '')
        if (!manifestCodes.delete(code)) return sendJson(res, 404, { message: 'Not Found' })
        return sendJson(res, 201, {
          id: Number(appId),
          slug,
          name: 'CirCI',
          client_id: 'Iv1.e2e',
          client_secret: 'e2e-client-secret',
          webhook_secret: webhookSecret,
          pem: privateKey,
          html_url: `http://${req.headers.host ?? 'github.invalid'}${prefix}/apps/${slug}`,
        })
      }
      if (auth === 'invalid' || auth === 'none') {
        return sendJson(res, 401, { message: 'Bad credentials' })
      }
      if (url.pathname === '/app' && method === 'GET' && auth === 'app') {
        return sendJson(res, 200, {
          id: Number(appId),
          slug,
          name: 'CirCI',
          html_url: `http://${req.headers.host ?? 'github.invalid'}${prefix}/apps/${slug}`,
        })
      }
      const obj = (body ?? {}) as Record<string, unknown>
      let m: RegExpExecArray | null

      if (
        (m = /^\/app\/installations\/([^/]+)\/access_tokens$/.exec(url.pathname)) &&
        method === 'POST'
      ) {
        if (auth !== 'app')
          return sendJson(res, 401, { message: 'A JSON web token could not be decoded' })
        tokenCounter += 1
        const token = `ghs_fake_${m[1]}_${tokenCounter}`
        tokens.add(token)
        return sendJson(res, 201, {
          token,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        })
      }
      if (auth === 'installation') {
        const owner = /^ghs_fake_(.+)_\d+$/.exec(
          (first(req.headers['authorization']) ?? '').replace(/^Bearer\s+/i, ''),
        )?.[1]
        if (owner && revoked.has(owner)) return sendJson(res, 401, { message: 'Bad credentials' })
      }
      if (auth !== 'installation')
        return sendJson(res, 403, { message: 'Resource not accessible by integration' })

      if (url.pathname === '/installation/repositories' && method === 'GET') {
        return sendJson(res, 200, { total_count: 0, repositories: [] })
      }
      if ((m = /^\/repos\/([^/]+\/[^/]+)\/check-runs$/.exec(url.pathname)) && method === 'POST') {
        const run = toCheckRun(nextId++, m[1] ?? '', obj)
        checkRuns.push(run)
        return sendJson(res, 201, { id: run.id, ...obj })
      }
      if (
        (m = /^\/repos\/([^/]+\/[^/]+)\/check-runs\/(\d+)$/.exec(url.pathname)) &&
        method === 'PATCH'
      ) {
        const run = checkRuns.find((c) => c.id === Number(m?.[2]) && c.repo === m?.[1])
        if (!run) return sendJson(res, 404, { message: 'Not Found' })
        applyCheckRun(run, obj)
        return sendJson(res, 200, { id: run.id })
      }
      if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(url.pathname))) {
        const repo = m[1] ?? ''
        const prNumber = Number(m[2])
        if (method === 'GET') {
          return sendJson(
            res,
            200,
            comments.filter((c) => c.repo === repo && c.prNumber === prNumber).map(wireComment),
          )
        }
        if (method === 'POST') {
          const comment: FakeGithub.Comment = {
            id: nextId++,
            repo,
            prNumber,
            body: text(obj['body']),
            reactions: [],
          }
          comments.push(comment)
          return sendJson(res, 201, wireComment(comment))
        }
      }
      if (
        (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/.exec(url.pathname)) &&
        method === 'PATCH'
      ) {
        const comment = comments.find((c) => c.id === Number(m?.[2]) && c.repo === m?.[1])
        if (!comment) return sendJson(res, 404, { message: 'Not Found' })
        comment.body = text(obj['body'])
        return sendJson(res, 200, wireComment(comment))
      }
      if (
        (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)\/reactions$/.exec(url.pathname)) &&
        method === 'POST'
      ) {
        const comment = comments.find((c) => c.id === Number(m?.[2]) && c.repo === m?.[1])
        if (!comment) return sendJson(res, 404, { message: 'Not Found' })
        comment.reactions.push(text(obj['content']))
        return sendJson(res, 201, { id: nextId++, content: obj['content'] })
      }
      if (
        (m = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)\/permission$/.exec(url.pathname)) &&
        method === 'GET'
      ) {
        const permission = permissions.get(`${m[1]}/${decodeURIComponent(m[2] ?? '')}`)
        if (!permission) return sendJson(res, 404, { message: 'Not Found' })
        return sendJson(res, 200, { permission, user: { login: decodeURIComponent(m[2] ?? '') } })
      }
      if (
        (m = /^\/repos\/([^/]+\/[^/]+)\/commits\/([0-9a-f]{7,40})$/.exec(url.pathname)) &&
        method === 'GET'
      ) {
        return sendJson(res, 200, { sha: m[2], commit: { message: 'fake commit' } })
      }
      if (
        (m = /^\/repos\/([^/]+\/[^/]+)\/statuses\/([0-9a-f]{7,40})$/.exec(url.pathname)) &&
        method === 'POST'
      ) {
        return sendJson(res, 201, { id: nextId++, ...obj })
      }
      return sendJson(res, 404, { message: `Not Found (fake-github has no ${label})` })
    })()
  })

  const host = options.host ?? 'host.docker.internal'
  const apiUrl = `http://${host}:${listening.port}${prefix}`

  return {
    apiUrl,
    port: listening.port,
    appId,
    privateKey,
    webhookSecret,
    env: () => ({
      GITHUB_APP_ID: appId,
      GITHUB_APP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
      GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
      GITHUB_API_URL: apiUrl,
    }),
    requests,
    checkRuns,
    comments,
    permissions,
    setPermission(repo, login, permission) {
      permissions.set(`${repo}/${login}`, permission)
    },
    failNext(match, status, times = 1) {
      failures.push({ match, status, remaining: times })
    },
    failNextWith(match, response, times = 1) {
      failures.push({ match, remaining: times, ...response })
    },
    delayNext(match, ms, times = 1) {
      delays.push({ match, ms, remaining: times })
    },
    seedComment(repo, prNumber, body) {
      const comment: FakeGithub.Comment = { id: nextId++, repo, prNumber, body, reactions: [] }
      comments.push(comment)
      return comment
    },
    slug,
    issueManifestCode() {
      codeCounter += 1
      const code = `manifest-code-${codeCounter}-${Math.random().toString(36).slice(2)}`
      manifestCodes.add(code)
      return code
    },
    issuedTokens: () => [...tokens],
    revokeInstallation: (id) => void revoked.add(id),
    restoreInstallation: (id) => void revoked.delete(id),
    find: (match) => requests.filter((r) => `${r.method} ${r.path}`.includes(match)),
    waitForRequest(match, o = {}) {
      const since = o.since ?? 0
      return waitUntil(
        () => requests.slice(since).find((r) => `${r.method} ${r.path}`.includes(match)),
        `a request to ${match}`,
        o.timeoutMs ?? 30_000,
      )
    },
    async sendWebhook(circiUrl, event, payload, o = {}) {
      const raw = JSON.stringify(payload)
      const signature = githubSignature(o.secret ?? webhookSecret, raw)
      const res = await fetch(`${circiUrl}/webhooks/github`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-github-event': event,
          'x-github-delivery':
            o.deliveryId ?? `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          'x-hub-signature-256': signature,
        },
        body: raw,
      })
      return { status: res.status, body: await res.text() }
    },
    clear() {
      requests.length = 0
      checkRuns.length = 0
      comments.length = 0
    },
    reset() {
      requests.length = 0
      checkRuns.length = 0
      comments.length = 0
      permissions.clear()
      failures.length = 0
      delays.length = 0
      revoked.clear()
      manifestCodes.clear()
    },
    close: () => listening.close(),
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function wireComment(c: FakeGithub.Comment) {
  return { id: c.id, body: c.body, user: { login: 'circi[bot]' } }
}

function toCheckRun(id: number, repo: string, body: Record<string, unknown>): FakeGithub.CheckRun {
  const run: FakeGithub.CheckRun = {
    id,
    repo,
    headSha: text(body['head_sha']),
    name: '',
    status: '',
    conclusion: undefined,
    title: '',
    summary: '',
    detailsUrl: undefined,
    actions: [],
    history: [],
  }
  applyCheckRun(run, body)
  return run
}

function applyCheckRun(run: FakeGithub.CheckRun, body: Record<string, unknown>): void {
  run.history.push(body)
  if (typeof body['name'] === 'string') run.name = body['name']
  if (typeof body['status'] === 'string') run.status = body['status']
  run.conclusion = typeof body['conclusion'] === 'string' ? body['conclusion'] : undefined
  if (typeof body['details_url'] === 'string') run.detailsUrl = body['details_url']
  const output = body['output'] as { title?: string; summary?: string } | undefined
  if (output) {
    run.title = output.title ?? ''
    run.summary = output.summary ?? ''
  }
  if (Array.isArray(body['actions'])) {
    run.actions = body['actions'] as FakeGithub.CheckRun['actions']
  }
}
