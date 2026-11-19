import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

/** Thin client for the CirCI `/v1` API, using the built-in fetch. */

export namespace ApiClient {
  export interface Options {
    baseUrl: string
    token: string
    fetch?: typeof fetch | undefined
    /** Per request, in milliseconds (default 30 s; file and site uploads get four times that). */
    timeoutMs?: number
    /** Tries per call for transient failures (default 4). */
    attempts?: number
    /** First backoff in milliseconds; each retry doubles it, with jitter (default 500). */
    retryDelayMs?: number | undefined
  }

  export interface Project {
    workspace: string
    slug: string
    name: string
    defaultBranch: string
    dashboardUrl: string
  }

  export interface Build {
    id: string
    number: number
    name: string
    status: string
    conclusion: string | null
    reviewStatus: string
    url: string
  }

  export interface UploadInstruction {
    sha256: string
    url: string
    method: 'PUT'
    headers: Record<string, string>
    /** `token`: send the project token too (uploads through the API, local-disk storage). */
    auth: 'token' | 'none'
  }

  export interface Status {
    build: ApiClient.Build
    counts: {
      added: number
      removed: number
      changed: number
      unchanged: number
      failed: number
      total: number
    }
    /** Screenshots the server couldn't read, with why. */
    unreadable: { name: string; reason: string }[]
    outcome: { state: 'pending' | 'pass' | 'fail'; summary: string; warning?: string }
    gate: 'exit-code' | 'status'
    errorMessage: string | null
  }

  export interface SiteUpload {
    site: { name: string; kind: string; slug: string }
    version: { commitSha: string; fileCount: number; totalBytes: number }
    addresses: { commit: string; branch?: string }
    branchMoved: boolean
    replaced: boolean
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** The server (or the way to it) didn't answer: a refused connection, an unknown host, a timeout. */
export class NetworkError extends Error {
  readonly url: string
  /** The Node error code (`ECONNREFUSED`…), `TIMEOUT`, or undefined. */
  readonly code: string | undefined
  constructor(url: string, code: string | undefined, detail: string) {
    super(`Couldn't reach ${originOf(url)} (${detail})`)
    this.name = 'NetworkError'
    this.url = url
    this.code = code
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    // Not a URL at all (a typo in CIRCI_API_URL): show what was typed, without the API path.
    return url.split('/v1/')[0] ?? url
  }
}

const CODE_TEXT: Record<string, string> = {
  ECONNREFUSED: 'connection refused',
  ENOTFOUND: 'host not found',
  EAI_AGAIN: 'host not found',
  ECONNRESET: 'connection reset',
  ETIMEDOUT: 'timed out',
  UND_ERR_CONNECT_TIMEOUT: 'timed out',
  CERT_HAS_EXPIRED: 'certificate expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed certificate',
  ERR_INVALID_URL: 'not a valid URL',
}

/** Turns what `fetch` throws (`TypeError: fetch failed` with a cause) into a `NetworkError`. */
function toNetworkError(url: string, err: unknown): NetworkError {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new NetworkError(url, 'TIMEOUT', 'timed out')
  }
  const cause: unknown = err instanceof Error ? err.cause : undefined
  const code =
    cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : err instanceof Error && 'code' in err && typeof err.code === 'string'
        ? err.code
        : undefined
  const detail =
    (code && CODE_TEXT[code]) ||
    code ||
    (cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err))
  return new NetworkError(url, code, detail)
}

/** Failures that mean the request never reached the application, so even a POST can be resent. */
const NEVER_ARRIVED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * Whether to resend after `err`. `safe` calls (reads, and writes that replace rather than add)
 * retry on any 5xx, 429 and network failure; others only when the request cannot have been
 * processed: the connection never opened, or a gateway (502/503/504) answered for the server.
 */
export function isRetryable(err: unknown, safe: boolean): boolean {
  if (err instanceof NetworkError) {
    if (err.code === 'ERR_INVALID_URL') return false
    return safe || (err.code !== undefined && NEVER_ARRIVED.has(err.code))
  }
  if (err instanceof ApiError) {
    if (safe) return err.status >= 500 || err.status === 429
    return err.status === 502 || err.status === 503 || err.status === 504
  }
  return false
}

/** Backoff for retry number `retry` (1, 2, …): `base * 2^(retry-1)`, scaled by 50-100% jitter. */
export function backoffDelay(retry: number, baseMs: number, random = Math.random): number {
  return Math.round(baseMs * 2 ** (retry - 1) * (0.5 + random() / 2))
}

/** Runs `fn`, resending after a transient failure (see `isRetryable`) with exponential backoff. */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { attempts: number; baseDelayMs: number; safe: boolean },
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retries are sequential by nature
      return await fn()
    } catch (err) {
      if (attempt >= options.attempts || !isRetryable(err, options.safe)) throw err
      // oxlint-disable-next-line no-await-in-loop -- backoff between retries
      await sleep(backoffDelay(attempt, options.baseDelayMs))
    }
  }
}

export class ApiClient {
  readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly retryDelayMs: number

  constructor(options: ApiClient.Options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.attempts = options.attempts ?? 4
    this.retryDelayMs = options.retryDelayMs ?? 500
  }

  project(): Promise<ApiClient.Project> {
    return this.json('GET', '/v1/project')
  }

  createBuild(
    body: Record<string, unknown>,
  ): Promise<{ build: ApiClient.Build; uploads: ApiClient.UploadInstruction[] }> {
    // One key per call, the same on every resend: when an answer is lost (a gateway timing out
    // after the server committed) the resend gets the build the first request made, not another.
    return this.json('POST', '/v1/builds', body, {
      safe: true,
      headers: { 'idempotency-key': randomUUID() },
    })
  }

  finalize(
    buildId: string,
    body: Record<string, unknown>,
  ): Promise<{
    build: ApiClient.Build
    complete: boolean
    shardsReceived: number
    shardsTotal: number
  }> {
    // Replaces the shard's screenshots in one transaction, and the server answers a repeat of one
    // it already finalized the same way: a resend lands on the same state.
    return this.json('POST', `/v1/builds/${buildId}/finalize`, body, { safe: true })
  }

  status(buildId: string, gate?: 'status' | 'exit-code'): Promise<ApiClient.Status> {
    return this.json('GET', `/v1/builds/${buildId}/status${gate ? `?gate=${gate}` : ''}`)
  }

  /** Uploads a site (a `.tar.gz`); the query says what and where it is. */
  uploadSite(query: Record<string, string>, archive: Uint8Array): Promise<ApiClient.SiteUpload> {
    // It replaces the version of that commit, so a resend is harmless.
    return withRetry(
      async () => {
        const res = await this.send(
          `${this.baseUrl}/v1/sites?${new URLSearchParams(query).toString()}`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/gzip' },
            body: archive,
          },
          this.timeoutMs * 4,
        )
        return this.parse<ApiClient.SiteUpload>(res)
      },
      { attempts: this.attempts, baseDelayMs: this.retryDelayMs, safe: true },
    )
  }

  /** The commit a branch's address serves now, or null when the server says it has none yet. */
  async servedCommit(name: string, branch: string): Promise<string | null> {
    const res = await this.json<{ commit: string | null }>(
      'GET',
      `/v1/sites/served?${new URLSearchParams({ name, branch }).toString()}`,
    )
    return res.commit
  }

  /** Sends one file as instructed by the server, retrying transient failures. */
  async upload(instruction: ApiClient.UploadInstruction, bytes: Uint8Array): Promise<void> {
    // fetch sets content-length itself from the body; passing it explicitly is not allowed.
    const headers = Object.fromEntries(
      Object.entries(instruction.headers).filter(([k]) => k.toLowerCase() !== 'content-length'),
    )
    if (instruction.auth === 'token') headers.authorization = `Bearer ${this.token}`
    try {
      await withRetry(
        async () => {
          const res = await this.send(
            instruction.url,
            { method: instruction.method, headers, body: bytes },
            this.timeoutMs * 4,
          )
          if (!res.ok) throw new ApiError(res.status, await safeText(res), undefined)
        },
        { attempts: this.attempts, baseDelayMs: this.retryDelayMs, safe: true },
      )
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? `${err.status} ${err.message}`.trim()
          : err instanceof Error
            ? err.message
            : String(err)
      throw new Error(`Upload of ${instruction.sha256.slice(0, 12)} failed: ${detail}`, {
        cause: err,
      })
    }
  }

  /** One request with a timeout; a failure to get an answer becomes a `NetworkError`. */
  private async send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      throw toNetworkError(url, err)
    }
  }

  /** Reads the answer; a non-2xx one throws an `ApiError` carrying the server's `error` text. */
  private async parse<T>(res: Response): Promise<T> {
    let text: string
    try {
      text = await res.text()
    } catch (err) {
      throw toNetworkError(res.url, err)
    }
    let parsed: unknown = undefined
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = text
    }
    if (!res.ok) {
      const message =
        typeof parsed === 'object' &&
        parsed !== null &&
        'error' in parsed &&
        typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${res.status}`
      throw new ApiError(res.status, message, parsed)
    }
    // The server's JSON is the contract here; shapes are covered by the API tests.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return parsed as T
  }

  private json<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { safe?: boolean; headers?: Record<string, string> } = {},
  ): Promise<T> {
    // Reads are always safe to resend.
    const safe = options.safe ?? method === 'GET'
    return withRetry(
      async () => {
        const res = await this.send(
          `${this.baseUrl}${path}`,
          {
            method,
            headers: {
              authorization: `Bearer ${this.token}`,
              ...options.headers,
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          this.timeoutMs,
        )
        return this.parse<T>(res)
      },
      { attempts: this.attempts, baseDelayMs: this.retryDelayMs, safe },
    )
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}
