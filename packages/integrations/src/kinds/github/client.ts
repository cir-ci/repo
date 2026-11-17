import { createHmac, createSign, timingSafeEqual } from 'node:crypto'

import { type GitProvider, headerValue, ProviderApiError } from '#src/git/provider.ts'
import { HELP_COMMENT_MARKER, PR_COMMENT_MARKER } from '#src/git/render.ts'
import { apiMessage, createHttpClient, type HttpClient } from '#src/http.ts'

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
  /** The App's webhook secret, for `verifyWebhook`. */
  webhookSecret?: string
  /** Give up on one API request after this long (default 15 s). */
  timeoutMs?: number
  /** Replaceable in tests. */
  fetch?: typeof fetch
  now?: () => number
}

export class GithubApiError extends ProviderApiError {
  constructor(status: number, message: string, options: { revoked?: boolean } = {}) {
    super(status, message, options)
    this.name = 'GithubApiError'
  }
}

/**
 * GitHub says the installation is gone: uninstalled or suspended. Retrying cannot help until
 * someone reinstalls the App, so callers stop and record that the project needs attention.
 * `status` is what GitHub answered (401, 404, or 403 for a suspended installation).
 */
export class GithubInstallationRevokedError extends GithubApiError {
  readonly installationId: string
  constructor(installationId: string, cause: GithubApiError) {
    super(cause.status, cause.message, { revoked: true })
    this.name = 'GithubInstallationRevokedError'
    this.installationId = installationId
  }
}

/** An artifact is larger than the caller allows (nothing was kept). Not a failure of the call: no retry helps. */
export class GithubArtifactTooLargeError extends Error {
  readonly bytes: number
  constructor(bytes: number) {
    super(`The artifact is ${bytes} bytes or more`)
    this.name = 'GithubArtifactTooLargeError'
    this.bytes = bytes
  }
}

export interface GithubArtifact {
  id: number
  name: string
  sizeInBytes: number
  expired: boolean
}

/** A 401 for a token, before it is known whether a fresh one helps. */
function isRejectedToken(err: unknown): err is GithubApiError {
  return (
    err instanceof GithubApiError &&
    !(err instanceof GithubInstallationRevokedError) &&
    err.status === 401
  )
}

const prop = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

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

/** Verifies GitHub's webhook signature header; the part of the adapter a webhook route needs. */
export function githubWebhookVerifier(secret: string): Pick<GitProvider, 'verifyWebhook'> {
  return {
    verifyWebhook: (rawBody, headers) =>
      verifyGithubSignature(secret, rawBody, headerValue(headers, 'x-hub-signature-256')),
  }
}

export class GithubApp implements GitProvider {
  readonly kind = 'github'
  readonly #options: GithubAppOptions
  readonly #tokens = new Map<string, { token: string; expiresAt: number }>()
  readonly #http: HttpClient

  constructor(options: GithubAppOptions) {
    this.#options = options
    this.#http = createHttpClient({
      baseUrl: options.apiUrl,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      fail: ({ status, data, method, path }) =>
        new GithubApiError(
          status,
          `GitHub ${method} ${path}: ${apiMessage(data, status, 'message')}`,
        ),
    })
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

  #call(
    auth: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    return this.#http.request(method, path, {
      headers: { authorization: `Bearer ${auth}` },
      ...(body === undefined ? {} : { body }),
    })
  }

  async #installationToken(installationId: string): Promise<string> {
    const cached = this.#tokens.get(installationId)
    if (cached && cached.expiresAt - 60_000 > this.#now()) return cached.token
    let data: unknown
    try {
      ;({ data } = await this.#call(
        this.appJwt(),
        'POST',
        `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
        {},
      ))
    } catch (err) {
      // 404: the installation does not exist (uninstalled). 401: GitHub refuses the App for it.
      // 403 "suspended": the owner suspended the App. Anything else (5xx, rate limits) is transient.
      if (
        err instanceof GithubApiError &&
        (err.status === 401 ||
          err.status === 404 ||
          (err.status === 403 && /suspended/i.test(err.message)))
      ) {
        throw new GithubInstallationRevokedError(installationId, err)
      }
      throw err
    }
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
    const attempt = async () =>
      this.#call(await this.#installationToken(installationId), method, path, body)
    try {
      return await attempt()
    } catch (err) {
      if (!isRejectedToken(err)) throw err
    }
    // A token GitHub no longer accepts (revoked, or the app was reinstalled): forget it and try
    // once with a fresh one, instead of failing until the cache expires. A 401 that survives the
    // refresh means the installation itself is gone.
    this.#tokens.delete(installationId)
    try {
      return await attempt()
    } catch (err) {
      if (isRejectedToken(err)) throw new GithubInstallationRevokedError(installationId, err)
      throw err
    }
  }

  /** The App itself (`GET /app`, as the App): its slug and public page. */
  async appInfo(): Promise<{ slug: string; name: string; htmlUrl: string }> {
    const { data } = await this.#call(this.appJwt(), 'GET', '/app')
    const field = (key: string) => {
      const value: unknown =
        typeof data === 'object' && data !== null ? Reflect.get(data, key) : undefined
      return typeof value === 'string' ? value : ''
    }
    return { slug: field('slug'), name: field('name'), htmlUrl: field('html_url') }
  }

  verifyWebhook(rawBody: Buffer | string, headers: GitProvider.WebhookHeaders): boolean {
    const secret = this.#options.webhookSecret
    return secret !== undefined && githubWebhookVerifier(secret).verifyWebhook(rawBody, headers)
  }

  /** The repositories the installation was given access to (`owner/name`), up to 500. */
  async listRepositories(installationId: string): Promise<GitProvider.Repository[]> {
    const repos: GitProvider.Repository[] = []
    for (let page = 1; page <= 5; page++) {
      // eslint-disable-next-line no-await-in-loop -- pages are fetched in order
      const { data } = await this.#api(
        installationId,
        'GET',
        `/installation/repositories?per_page=100&page=${page}`,
      )
      const list: unknown =
        typeof data === 'object' && data !== null ? Reflect.get(data, 'repositories') : undefined
      if (!Array.isArray(list)) break
      for (const r of list) {
        const ref: unknown =
          typeof r === 'object' && r !== null ? Reflect.get(r, 'full_name') : undefined
        if (typeof ref === 'string') {
          repos.push({ ref, private: Reflect.get(r, 'private') === true })
        }
      }
      if (list.length < 100) break
    }
    return repos
  }

  /** Creates the check run for a commit, or updates `existingId`. Returns its id. */
  async upsertCheckRun(
    installationId: string,
    repo: string,
    input: GitProvider.StatusInput,
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
   * Writes the pull request's summary comment: edits `existingId`, else finds the App's own comment
   * carrying the marker (after a lost id), else creates it. Returns the comment's id.
   */
  upsertComment(
    installationId: string,
    repo: string,
    prNumber: number,
    body: string,
    existingId?: string,
  ): Promise<string> {
    return this.#writeMarked(installationId, repo, prNumber, PR_COMMENT_MARKER, body, existingId)
  }

  /** Whether GitHub says this comment was written by this App (not a person quoting its marker). */
  #isOwn(comment: unknown): boolean {
    return (
      prop(prop(comment, 'user'), 'type') === 'Bot' &&
      String(prop(prop(comment, 'performed_via_github_app'), 'id')) === this.#options.appId
    )
  }

  /** The App's own comment carrying `marker`, searching every page of the pull request's comments. */
  async #findOwn(
    installationId: string,
    repo: string,
    prNumber: number,
    marker: string,
  ): Promise<string | undefined> {
    for (let page = 1; page <= 30; page++) {
      // eslint-disable-next-line no-await-in-loop -- pages are fetched in order
      const { data } = await this.#api(
        installationId,
        'GET',
        `/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      )
      if (!Array.isArray(data)) return undefined
      const found = data.find(
        (c: unknown) =>
          this.#isOwn(c) &&
          typeof Reflect.get(Object(c), 'body') === 'string' &&
          String(Reflect.get(Object(c), 'body')).includes(marker),
      )
      const foundId: unknown = found ? Reflect.get(found, 'id') : undefined
      if (typeof foundId === 'number' || typeof foundId === 'string') return String(foundId)
      if (data.length < 100) return undefined
    }
    return undefined
  }

  /** Edits the comment `existingId` (or the App's own one with `marker`), else creates one. */
  async #writeMarked(
    installationId: string,
    repo: string,
    prNumber: number,
    marker: string,
    body: string,
    existingId?: string,
  ): Promise<string> {
    const id = existingId ?? (await this.#findOwn(installationId, repo, prNumber, marker))
    if (id) {
      try {
        await this.#api(installationId, 'PATCH', `/repos/${repo}/issues/comments/${id}`, { body })
        return id
      } catch (err) {
        if (
          !(err instanceof GithubApiError) ||
          err instanceof GithubInstallationRevokedError ||
          (err.status !== 404 && err.status !== 403)
        )
          throw err
        // Deleted, or not ours to edit: write a new one.
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

  /**
   * A reply on a pull request. All replies share one help comment per pull request, which this
   * edits in place (or creates the first time), so a refused command never piles up comments.
   */
  async reply(installationId: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.#writeMarked(
      installationId,
      repo,
      prNumber,
      HELP_COMMENT_MARKER,
      `${HELP_COMMENT_MARKER}\n${body}`,
    )
  }

  /** Says something on a check run itself (its title and summary), for a button that did nothing. */
  async noteOnCheckRun(
    installationId: string,
    repo: string,
    checkRunId: string,
    note: { title: string; summary: string },
  ): Promise<void> {
    await this.#api(installationId, 'PATCH', `/repos/${repo}/check-runs/${checkRunId}`, {
      output: { title: note.title.slice(0, 255), summary: note.summary },
    })
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

  /** The commit a branch points at, or null when it doesn't exist. */
  async branchTip(installationId: string, repo: string, branch: string): Promise<string | null> {
    const ref = branch.split('/').map(encodeURIComponent).join('/')
    try {
      const { data } = await this.#api(installationId, 'GET', `/repos/${repo}/git/ref/heads/${ref}`)
      const sha: unknown = prop(prop(data, 'object'), 'sha')
      return typeof sha === 'string' ? sha : null
    } catch (err) {
      if (
        err instanceof GithubApiError &&
        !(err instanceof GithubInstallationRevokedError) &&
        err.status === 404
      ) {
        return null
      }
      throw err
    }
  }

  /** The artifacts of a workflow run, newest first (up to 300). */
  async listRunArtifacts(
    installationId: string,
    repo: string,
    runId: string,
  ): Promise<GithubArtifact[]> {
    const found: GithubArtifact[] = []
    for (let page = 1; page <= 3; page++) {
      // eslint-disable-next-line no-await-in-loop -- pages are fetched in order
      const { data } = await this.#api(
        installationId,
        'GET',
        `/repos/${repo}/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100&page=${page}`,
      )
      const list: unknown =
        typeof data === 'object' && data !== null ? Reflect.get(data, 'artifacts') : undefined
      if (!Array.isArray(list)) break
      for (const a of list) {
        const id: unknown = prop(a, 'id')
        const name: unknown = prop(a, 'name')
        if (typeof id !== 'number' || typeof name !== 'string') continue
        const size: unknown = prop(a, 'size_in_bytes')
        found.push({
          id,
          name,
          sizeInBytes: typeof size === 'number' ? size : 0,
          expired: prop(a, 'expired') === true,
        })
      }
      if (list.length < 100) break
    }
    return found
  }

  /**
   * The zip of one artifact. GitHub answers with a redirect to a signed address: it is followed
   * WITHOUT the installation token (the signature is the credential there; the token must never
   * leave GitHub's API). Reads at most `maxBytes`, else throws `GithubArtifactTooLargeError`.
   */
  async downloadArtifact(
    installationId: string,
    repo: string,
    artifactId: number | string,
    maxBytes: number,
  ): Promise<Buffer> {
    const fetcher = this.#options.fetch ?? fetch
    const timeout = () => AbortSignal.timeout(this.#options.timeoutMs ?? 15_000)
    const request = async (token: string) =>
      fetcher(`${this.#options.apiUrl}/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'CirCI',
        },
        redirect: 'manual',
        signal: timeout(),
      })
    let res = await request(await this.#installationToken(installationId))
    if (res.status === 401) {
      this.#tokens.delete(installationId)
      res = await request(await this.#installationToken(installationId))
      if (res.status === 401) {
        throw new GithubInstallationRevokedError(
          installationId,
          new GithubApiError(401, 'GitHub refused the installation token'),
        )
      }
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      let target: URL | undefined
      try {
        target = location ? new URL(location, this.#options.apiUrl) : undefined
      } catch {
        target = undefined
      }
      if (!target || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
        throw new GithubApiError(502, 'GitHub sent no address for the artifact')
      }
      await res.body?.cancel()
      // No authorization header: the address is signed.
      res = await fetcher(target, {
        headers: { 'user-agent': 'CirCI' },
        signal: timeout(),
      })
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw new GithubApiError(
        res.status,
        `GitHub GET /repos/${repo}/actions/artifacts/${artifactId}/zip: HTTP ${res.status}`,
      )
    }
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel()
      throw new GithubArtifactTooLargeError(declared)
    }
    const chunks: Uint8Array[] = []
    let size = 0
    if (res.body) {
      for await (const chunk of res.body) {
        size += chunk.length
        if (size > maxBytes) {
          await res.body.cancel()
          throw new GithubArtifactTooLargeError(size)
        }
        chunks.push(chunk)
      }
    }
    return Buffer.concat(chunks)
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
      if (
        err instanceof GithubApiError &&
        !(err instanceof GithubInstallationRevokedError) &&
        err.status === 404
      )
        return false
      throw err
    }
  }
}
