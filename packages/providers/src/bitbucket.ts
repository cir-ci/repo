import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { createHttpClient } from './http.ts'
import { type GitProvider, headerValue, ProviderApiError } from './provider.ts'
import { PR_COMMENT_MARKER } from './render.ts'

/**
 * Bitbucket Cloud, through a workspace or repository access token (or an app password with its
 * username). One connection is one workspace (`externalId` is its slug); the token is the
 * connection's own credential, passed to every call as the sealed-then-opened `credentials`
 * string (`BitbucketCredentials`, as JSON). Statuses go on the commit, the summary is one comment
 * on the pull request.
 */

export interface BitbucketOptions {
  /** Default `https://api.bitbucket.org/2.0`. */
  apiUrl?: string
  /** What Bitbucket signs deliveries with (`X-Hub-Signature`), for `verifyWebhook`. */
  webhookSecret?: string
  /** Replaceable in tests. */
  fetch?: typeof fetch
}

export interface BitbucketCredentials {
  /** An access token, or the app password when `username` is given. */
  token: string
  /** Set for an app password: sent as basic authentication. */
  username?: string
}

/** The text sealed into `integrations.encrypted_credentials`. */
export const serializeBitbucketCredentials = (c: BitbucketCredentials): string => JSON.stringify(c)

const DEFAULT_API = 'https://api.bitbucket.org/2.0'

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined
const obj = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}

function parseCredentials(credentials: string | undefined): BitbucketCredentials {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = credentials ? obj(JSON.parse(credentials)) : {}
  } catch {
    parsed = {}
  }
  const token = text(parsed.token)
  if (!token) throw new ProviderApiError(400, 'This Bitbucket connection has no credentials')
  const username = text(parsed.username)
  return username ? { token, username } : { token }
}

/** Bitbucket signs each delivery body when the webhook has a secret: `X-Hub-Signature: sha256=<hex>`. */
export function verifyBitbucketSignature(
  secret: string,
  rawBody: Buffer | string,
  header: string | undefined,
): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const given = Buffer.from(header.slice('sha256='.length), 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Verifies Bitbucket's webhook signature header; the part of the adapter a webhook route needs. */
export function bitbucketWebhookVerifier(secret: string): Pick<GitProvider, 'verifyWebhook'> {
  return {
    verifyWebhook: (rawBody, headers) =>
      verifyBitbucketSignature(secret, rawBody, headerValue(headers, 'x-hub-signature')),
  }
}

/** The status key for a build name: unique per name, within Bitbucket's 40 characters. */
export const bitbucketStatusKey = (name: string) =>
  `circi-${createHash('sha256').update(name).digest('hex').slice(0, 24)}`

type BuildState = 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS'

const stateOf = (report: GitProvider.StatusInput['report']): BuildState =>
  report.status === 'in_progress'
    ? 'INPROGRESS'
    : report.conclusion === 'success' || report.conclusion === 'neutral'
      ? 'SUCCESSFUL'
      : 'FAILED'

const repoPath = (repo: string) => repo.split('/').map(encodeURIComponent).join('/')

export class BitbucketCloud implements GitProvider {
  readonly kind = 'bitbucket'
  readonly #options: BitbucketOptions

  constructor(options: BitbucketOptions = {}) {
    this.#options = options
  }

  async #call(
    credentials: string | undefined,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const { token, username } = parseCredentials(credentials)
    const authorization = username
      ? `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
      : `Bearer ${token}`
    // `next` links from Bitbucket are absolute: they are used as they are.
    const absolute = path.startsWith('https://')
    const res = await createHttpClient({
      baseUrl: absolute ? '' : (this.#options.apiUrl ?? DEFAULT_API),
      ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
      headers: { accept: 'application/json', authorization },
      // 401: the token is wrong, expired or revoked. Retrying cannot help.
      fail: ({ status, data }) =>
        new ProviderApiError(
          status,
          `Bitbucket ${method} ${path}: ${text(obj(obj(data).error).message) ?? `HTTP ${status}`}`,
          { revoked: status === 401 },
        ),
    }).request(method, path, body === undefined ? {} : { body })
    return res.data
  }

  verifyWebhook(rawBody: Buffer | string, headers: GitProvider.WebhookHeaders): boolean {
    const secret = this.#options.webhookSecret
    return secret !== undefined && bitbucketWebhookVerifier(secret).verifyWebhook(rawBody, headers)
  }

  /** The repositories of the workspace the token can see (`workspace/repo`), up to 500. */
  async listRepositories(
    workspace: string,
    credentials?: string,
  ): Promise<GitProvider.Repository[]> {
    const repos: GitProvider.Repository[] = []
    let next: string | undefined = `/repositories/${encodeURIComponent(workspace)}?pagelen=100`
    for (let page = 0; next && page < 5; page++) {
      // eslint-disable-next-line no-await-in-loop -- pages are fetched in order
      const data = obj(await this.#call(credentials, 'GET', next))
      const values: unknown = data.values
      if (Array.isArray(values)) {
        for (const r of values) {
          const ref = text(obj(r).full_name)
          if (ref) repos.push({ ref, private: obj(r).is_private === true })
        }
      }
      next = text(data.next)
    }
    return repos
  }

  /**
   * Sets the build's status on its commit. Bitbucket keeps one status per key and commit and
   * overwrites it on every post, so the key (derived from the name) is the id.
   */
  async upsertCheckRun(
    _workspace: string,
    repo: string,
    input: GitProvider.StatusInput,
    credentials?: string,
  ): Promise<string> {
    const { report } = input
    const key = bitbucketStatusKey(report.name)
    await this.#call(
      credentials,
      'POST',
      `/repositories/${repoPath(repo)}/commit/${encodeURIComponent(input.sha)}/statuses/build`,
      {
        key,
        state: stateOf(report),
        name: report.name.slice(0, 255),
        description: report.title.slice(0, 255),
        url: input.detailsUrl,
      },
    )
    return key
  }

  /** Edits `existingId`, else finds the comment carrying the marker, else creates it. */
  async upsertComment(
    _workspace: string,
    repo: string,
    prNumber: number,
    body: string,
    existingId?: string,
    credentials?: string,
  ): Promise<string> {
    const base = `/repositories/${repoPath(repo)}/pullrequests/${prNumber}/comments`
    let id = existingId
    if (!id) {
      let next: string | undefined = `${base}?pagelen=100`
      for (let page = 0; next && !id && page < 5; page++) {
        // eslint-disable-next-line no-await-in-loop -- pages are fetched in order
        const data = obj(await this.#call(credentials, 'GET', next))
        const values: unknown = data.values
        const found = Array.isArray(values)
          ? values.find(
              (c) =>
                obj(c).deleted !== true &&
                (text(obj(obj(c).content).raw) ?? '').includes(PR_COMMENT_MARKER),
            )
          : undefined
        id = found ? text(obj(found).id) : undefined
        next = text(data.next)
      }
    }
    if (id) {
      try {
        await this.#call(credentials, 'PUT', `${base}/${encodeURIComponent(id)}`, {
          content: { raw: body },
        })
        return id
      } catch (err) {
        if (!(err instanceof ProviderApiError) || err.revoked || err.status !== 404) throw err
        // Deleted by someone: write a new one.
      }
    }
    return this.#createComment(repo, prNumber, body, credentials)
  }

  async #createComment(
    repo: string,
    prNumber: number,
    body: string,
    credentials: string | undefined,
  ): Promise<string> {
    const data = await this.#call(
      credentials,
      'POST',
      `/repositories/${repoPath(repo)}/pullrequests/${prNumber}/comments`,
      { content: { raw: body } },
    )
    const id = text(obj(data).id)
    if (!id) throw new ProviderApiError(502, 'Bitbucket returned no comment id')
    return id
  }

  /** A plain reply on a pull request. */
  async reply(
    _workspace: string,
    repo: string,
    prNumber: number,
    body: string,
    credentials?: string,
  ): Promise<void> {
    await this.#createComment(repo, prNumber, body, credentials)
  }
}
