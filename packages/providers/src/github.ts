import { createHmac, createSign, timingSafeEqual } from 'node:crypto'

import { type CheckReport, PR_COMMENT_MARKER } from './render.ts'

/**
 * GitHub, through a GitHub App (PLAN §7.4): sign in as the app, get a short-lived installation
 * token, then write check runs and comments as `<app>[bot]`. GitHub Enterprise Server works by
 * pointing `apiUrl` at its `/api/v3`.
 */

export interface GithubAppOptions {
  /** `https://api.github.com`, or a GHES `https://host/api/v3`. */
  apiUrl: string
  appId: string
  /** The app's private key (PEM). */
  privateKey: string
  /** Replaceable in tests. */
  fetch?: typeof fetch
  now?: () => number
}

export class GithubApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GithubApiError'
    this.status = status
  }
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url')

/** GitHub signs each webhook body with the secret: `X-Hub-Signature-256: sha256=<hex>`. */
export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer | string,
  header: string | undefined,
): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const given = Buffer.from(header.slice('sha256='.length), 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export class GithubApp {
  readonly #options: GithubAppOptions
  readonly #tokens = new Map<string, { token: string; expiresAt: number }>()

  constructor(options: GithubAppOptions) {
    this.#options = options
  }

  #now() {
    return this.#options.now?.() ?? Date.now()
  }

  /** The app's own identity: a JWT valid for ten minutes. */
  appJwt(): string {
    const iat = Math.floor(this.#now() / 1000) - 30
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: this.#options.appId }))
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${payload}`)
      .sign(this.#options.privateKey)
    return `${header}.${payload}.${b64url(signature)}`
  }

  async #call(
    auth: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const res = await (this.#options.fetch ?? fetch)(`${this.#options.apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${auth}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'CirCI',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    let data: unknown = undefined
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = undefined
    }
    if (!res.ok) {
      const message =
        typeof data === 'object' &&
        data !== null &&
        typeof Reflect.get(data, 'message') === 'string'
          ? String(Reflect.get(data, 'message'))
          : `HTTP ${res.status}`
      throw new GithubApiError(res.status, `GitHub ${method} ${path}: ${message}`)
    }
    return { status: res.status, data }
  }

  async #installationToken(installationId: string): Promise<string> {
    const cached = this.#tokens.get(installationId)
    if (cached && cached.expiresAt - 60_000 > this.#now()) return cached.token
    const { data } = await this.#call(
      this.appJwt(),
      'POST',
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      {},
    )
    const token = typeof data === 'object' && data !== null ? Reflect.get(data, 'token') : undefined
    const expires =
      typeof data === 'object' && data !== null ? Reflect.get(data, 'expires_at') : undefined
    if (typeof token !== 'string') throw new GithubApiError(502, 'GitHub returned no token')
    this.#tokens.set(installationId, {
      token,
      expiresAt: typeof expires === 'string' ? Date.parse(expires) : this.#now() + 50 * 60_000,
    })
    return token
  }

  async #api(installationId: string, method: string, path: string, body?: unknown) {
    try {
      return await this.#call(await this.#installationToken(installationId), method, path, body)
    } catch (err) {
      // A cached token GitHub no longer accepts (revoked, or the app was reinstalled): forget it
      // and try once with a fresh one, instead of failing until the cache expires.
      if (
        !(err instanceof GithubApiError) ||
        err.status !== 401 ||
        !this.#tokens.has(installationId)
      )
        throw err
      this.#tokens.delete(installationId)
      return this.#call(await this.#installationToken(installationId), method, path, body)
    }
  }

  /** Creates the check run for a commit, or updates `existingId`. Returns its id. */
  async upsertCheckRun(
    installationId: string,
    repo: string,
    input: { sha: string; report: CheckReport; detailsUrl: string; existingId?: string },
  ): Promise<string> {
    const { report } = input
    const body = {
      name: report.name,
      status: report.status,
      ...(report.status === 'completed'
        ? {
            conclusion: report.conclusion ?? 'neutral',
            completed_at: new Date(this.#now()).toISOString(),
          }
        : {}),
      details_url: input.detailsUrl,
      output: { title: report.title.slice(0, 255), summary: report.summary },
      actions: report.actions.map((a) => ({
        identifier: a.identifier,
        label: a.label.slice(0, 20),
        description: a.description.slice(0, 40),
      })),
    }
    const response = input.existingId
      ? await this.#api(
          installationId,
          'PATCH',
          `/repos/${repo}/check-runs/${input.existingId}`,
          body,
        )
      : await this.#api(installationId, 'POST', `/repos/${repo}/check-runs`, {
          ...body,
          head_sha: input.sha,
        })
    const id =
      typeof response.data === 'object' && response.data !== null
        ? Reflect.get(response.data, 'id')
        : undefined
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new GithubApiError(502, 'GitHub returned no check run id')
    }
    return String(id)
  }

  /**
   * Writes the pull request's summary comment: edits `existingId`, else finds one carrying
   * the marker (after a lost id), else creates it. Returns the comment's id.
   */
  async upsertComment(
    installationId: string,
    repo: string,
    prNumber: number,
    body: string,
    existingId?: string,
  ): Promise<string> {
    let id = existingId
    if (!id) {
      const { data } = await this.#api(
        installationId,
        'GET',
        `/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
      )
      const found = Array.isArray(data)
        ? data.find(
            (c: unknown) =>
              typeof c === 'object' &&
              c !== null &&
              typeof Reflect.get(c, 'body') === 'string' &&
              String(Reflect.get(c, 'body')).includes(PR_COMMENT_MARKER),
          )
        : undefined
      const foundId: unknown = found ? Reflect.get(found, 'id') : undefined
      if (typeof foundId === 'number' || typeof foundId === 'string') id = String(foundId)
    }
    if (id) {
      try {
        await this.#api(installationId, 'PATCH', `/repos/${repo}/issues/comments/${id}`, { body })
        return id
      } catch (err) {
        if (!(err instanceof GithubApiError) || err.status !== 404) throw err
        // Deleted by someone: write a new one.
      }
    }
    return this.#createComment(installationId, repo, prNumber, body)
  }

  async #createComment(installationId: string, repo: string, prNumber: number, body: string) {
    const { data } = await this.#api(
      installationId,
      'POST',
      `/repos/${repo}/issues/${prNumber}/comments`,
      { body },
    )
    const id = typeof data === 'object' && data !== null ? Reflect.get(data, 'id') : undefined
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new GithubApiError(502, 'GitHub returned no comment id')
    }
    return String(id)
  }

  /** A plain reply on a pull request. */
  async reply(installationId: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.#createComment(installationId, repo, prNumber, body)
  }

  /** A reaction (👍 = `+1`) on a comment. */
  async react(
    installationId: string,
    repo: string,
    commentId: string | number,
    content: '+1' | '-1' | 'eyes',
  ): Promise<void> {
    await this.#api(
      installationId,
      'POST',
      `/repos/${repo}/issues/comments/${commentId}/reactions`,
      {
        content,
      },
    )
  }

  /** Whether the user has at least write access to the repo (`admin`, `maintain`, `write`). */
  async canWrite(installationId: string, repo: string, login: string): Promise<boolean> {
    try {
      const { data } = await this.#api(
        installationId,
        'GET',
        `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
      )
      const permission =
        typeof data === 'object' && data !== null ? Reflect.get(data, 'permission') : undefined
      return ['admin', 'maintain', 'write'].includes(String(permission))
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 404) return false
      throw err
    }
  }
}
