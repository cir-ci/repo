import { createHash, timingSafeEqual } from 'node:crypto'

import { type GitProvider, headerValue, ProviderApiError } from './provider.ts'
import { PR_COMMENT_MARKER } from './render.ts'

/**
 * GitLab (gitlab.com or self-managed), through an access token: a project or group access token,
 * or a personal one, with the `api` scope. It reports a build as a commit status on the merge
 * request's head commit, keeps one summary note on the merge request, and lists the projects the
 * token can see.
 *
 * Where the details live (a decision, so the rest of the code never guesses):
 * - `integrations.encrypted_credentials` holds, sealed with `sealSecret`, the JSON
 *   `{"baseUrl":"https://gitlab.example.com","token":"glpat-…"}` (see `gitlabCredentials`). The
 *   base URL belongs to the credentials because every call needs both together.
 * - `integrations.external_id` is `<host>#<user id>` of the token's principal (a project
 *   access token's bot user has its own id), from `GET /user`, so the same token principal on the
 *   same instance cannot be connected to two workspaces.
 * - Webhooks: GitLab sends the secret token it was configured with in `X-Gitlab-Token`; the
 *   instance has one, derived from the instance secret and shown to admins on the GitLab page.
 */

export interface GitlabOptions {
  /** The instance's webhook secret, for `verifyWebhook`. Without it every delivery is refused. */
  webhookSecret?: string
  /** Replaceable in tests. */
  fetch?: typeof fetch
}

/** What a GitLab connection's sealed credentials say. */
export interface GitlabCredentials {
  /** `https://gitlab.com` or a self-managed instance's address, no trailing slash. */
  baseUrl: string
  token: string
}

export class GitlabApiError extends ProviderApiError {
  constructor(status: number, message: string, options: { revoked?: boolean } = {}) {
    super(status, message, options)
    this.name = 'GitlabApiError'
  }
}

/** A GitLab address reduced to its origin, or undefined when it is not an http(s) address. */
export function normalizeGitlabBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    // Self-managed GitLab can live under a path (`https://host/gitlab`): keep it.
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return undefined
  }
}

/** The JSON stored (sealed) for a connection. */
export const gitlabCredentials = (baseUrl: string, token: string): string =>
  JSON.stringify({ baseUrl, token } satisfies GitlabCredentials)

export function parseGitlabCredentials(credentials: string | undefined): GitlabCredentials {
  let parsed: unknown
  try {
    parsed = credentials ? JSON.parse(credentials) : undefined
  } catch {
    parsed = undefined
  }
  const baseUrl: unknown = typeof parsed === 'object' && parsed ? Reflect.get(parsed, 'baseUrl') : 0
  const token: unknown = typeof parsed === 'object' && parsed ? Reflect.get(parsed, 'token') : 0
  if (typeof baseUrl !== 'string' || typeof token !== 'string' || !token) {
    throw new GitlabApiError(400, 'GitLab credentials are missing or malformed')
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token }
}

/** `<host>#<user id>`: the connection's external id. */
export const gitlabExternalId = (baseUrl: string, userId: number | string) =>
  `${new URL(baseUrl).host}#${userId}`

/** The host part of a connection's external id (`gitlab.example.com` of `gitlab.example.com#7`). */
export const gitlabHostOf = (externalId: string) => externalId.split('#')[0] ?? externalId

const digest = (v: string) => createHash('sha256').update(v).digest()

/**
 * GitLab sends the configured secret as `X-Gitlab-Token`, unsigned. Compared in constant time:
 * both sides are hashed first, so neither the length nor any prefix of the secret leaks.
 */
export function verifyGitlabToken(secret: string, header: string | undefined): boolean {
  if (!secret || header === undefined) return false
  return timingSafeEqual(digest(secret), digest(header))
}

/** Verifies GitLab's webhook token header; the part of the adapter a webhook route needs. */
export function gitlabWebhookVerifier(secret: string): Pick<GitProvider, 'verifyWebhook'> {
  return {
    verifyWebhook: (_rawBody, headers) =>
      verifyGitlabToken(secret, headerValue(headers, 'x-gitlab-token')),
  }
}

const STATE: Record<NonNullable<GitProvider.StatusInput['report']['conclusion']>, string> = {
  success: 'success',
  neutral: 'success',
  failure: 'failed',
  // Changes await review: failed holds a merge that requires the status, like GitHub's check.
  action_required: 'failed',
}

const asId = (value: unknown): string | undefined =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : undefined

const field = (value: unknown, name: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined

export class GitlabProvider implements GitProvider {
  readonly kind = 'gitlab'
  readonly #options: GitlabOptions

  constructor(options: GitlabOptions = {}) {
    this.#options = options
  }

  async #call(
    creds: GitlabCredentials,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const res = await (this.#options.fetch ?? fetch)(`${creds.baseUrl}/api/v4${path}`, {
      method,
      headers: {
        'private-token': creds.token,
        'user-agent': 'CirCI',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = undefined
    }
    if (!res.ok) {
      const raw = field(data, 'message') ?? field(data, 'error')
      const message = typeof raw === 'string' ? raw : `HTTP ${res.status}`
      // 401: the token is revoked or expired. Anything else (403 scope, 404, 5xx) may be fixed
      // or transient, so it is not "the connection is gone".
      throw new GitlabApiError(res.status, `GitLab ${method} ${path}: ${message}`, {
        revoked: res.status === 401,
      })
    }
    return data
  }

  verifyWebhook(_rawBody: Buffer | string, headers: GitProvider.WebhookHeaders): boolean {
    const secret = this.#options.webhookSecret
    return secret !== undefined && verifyGitlabToken(secret, headerValue(headers, 'x-gitlab-token'))
  }

  /** The token's principal (`GET /user`): what `external_id` is built from. */
  async identify(credentials: string): Promise<{ id: string; username: string }> {
    const data = await this.#call(parseGitlabCredentials(credentials), 'GET', '/user')
    const id = asId(field(data, 'id'))
    const username = field(data, 'username')
    if (!id) throw new GitlabApiError(502, 'GitLab returned no user')
    return { id, username: typeof username === 'string' ? username : id }
  }

  /** The projects the token is a member of (`group/sub/name`), up to 500. */
  async listRepositories(
    _externalId: string,
    credentials?: string,
  ): Promise<GitProvider.Repository[]> {
    const creds = parseGitlabCredentials(credentials)
    const repos: GitProvider.Repository[] = []
    for (let page = 1; page <= 5; page++) {
      // eslint-disable-next-line no-await-in-loop -- pages are fetched in order
      const data = await this.#call(
        creds,
        'GET',
        `/projects?membership=true&simple=true&archived=false&per_page=100&page=${page}`,
      )
      if (!Array.isArray(data)) break
      for (const p of data) {
        const ref = field(p, 'path_with_namespace')
        if (typeof ref === 'string') {
          repos.push({ ref, private: field(p, 'visibility') !== 'public' })
        }
      }
      if (data.length < 100) break
    }
    return repos
  }

  /**
   * A commit status named after the build on the commit. GitLab has no update call: posting the
   * same name on the same commit again replaces it, so `existingId` is only handed back.
   */
  async upsertCheckRun(
    _externalId: string,
    repo: string,
    input: GitProvider.StatusInput,
    credentials?: string,
  ): Promise<string> {
    const creds = parseGitlabCredentials(credentials)
    const { report } = input
    const state = report.status === 'completed' ? STATE[report.conclusion ?? 'neutral'] : 'running'
    const data = await this.#call(
      creds,
      'POST',
      `/projects/${encodeURIComponent(repo)}/statuses/${encodeURIComponent(input.sha)}`,
      {
        state,
        name: report.name,
        target_url: input.detailsUrl,
        description: report.title.slice(0, 140),
      },
    )
    return input.existingId ?? asId(field(data, 'id')) ?? report.name
  }

  async upsertComment(
    _externalId: string,
    repo: string,
    prNumber: number,
    body: string,
    existingId?: string,
    credentials?: string,
  ): Promise<string> {
    const creds = parseGitlabCredentials(credentials)
    const notes = `/projects/${encodeURIComponent(repo)}/merge_requests/${prNumber}/notes`
    let id = existingId
    if (!id) id = await this.#findNote(creds, notes)
    if (id) {
      try {
        await this.#call(creds, 'PUT', `${notes}/${id}`, { body })
        return id
      } catch (err) {
        // Deleted by someone: write a new one.
        if (!(err instanceof GitlabApiError) || err.status !== 404) throw err
      }
    }
    const created = await this.#call(creds, 'POST', notes, { body })
    const createdId = asId(field(created, 'id'))
    if (!createdId) throw new GitlabApiError(502, 'GitLab returned no note id')
    return createdId
  }

  async #findNote(creds: GitlabCredentials, notes: string): Promise<string | undefined> {
    for (let page = 1; page <= 5; page++) {
      // eslint-disable-next-line no-await-in-loop -- pages are fetched in order
      const data = await this.#call(creds, 'GET', `${notes}?per_page=100&page=${page}`)
      if (!Array.isArray(data)) return undefined
      const found = data.find((n: unknown) => {
        const body = field(n, 'body')
        return typeof body === 'string' && body.includes(PR_COMMENT_MARKER)
      })
      if (found) return asId(field(found, 'id'))
      if (data.length < 100) return undefined
    }
    return undefined
  }

  /** A plain note on a merge request. */
  async reply(repo: string, prNumber: number, body: string, credentials?: string): Promise<void> {
    await this.#call(
      parseGitlabCredentials(credentials),
      'POST',
      `/projects/${encodeURIComponent(repo)}/merge_requests/${prNumber}/notes`,
      { body },
    )
  }

  /** An award emoji (`thumbsup`, `thumbsdown`) on a note. */
  async react(
    repo: string,
    prNumber: number,
    noteId: string | number,
    emoji: 'thumbsup' | 'thumbsdown',
    credentials?: string,
  ): Promise<void> {
    await this.#call(
      parseGitlabCredentials(credentials),
      'POST',
      `/projects/${encodeURIComponent(repo)}/merge_requests/${prNumber}/notes/${noteId}/award_emoji`,
      { name: emoji },
    )
  }
}
