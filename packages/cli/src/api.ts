/** Thin client for the CirCI `/v1` API, using the built-in fetch. */

export namespace ApiClient {
  export interface Options {
    baseUrl: string
    token: string
    fetch?: typeof fetch
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

export class ApiClient {
  readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: ApiClient.Options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
  }

  project(): Promise<ApiClient.Project> {
    return this.json('GET', '/v1/project')
  }

  createBuild(
    body: Record<string, unknown>,
  ): Promise<{ build: ApiClient.Build; uploads: ApiClient.UploadInstruction[] }> {
    return this.json('POST', '/v1/builds', body)
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
    return this.json('POST', `/v1/builds/${buildId}/finalize`, body)
  }

  status(buildId: string, gate?: 'status' | 'exit-code'): Promise<ApiClient.Status> {
    return this.json('GET', `/v1/builds/${buildId}/status${gate ? `?gate=${gate}` : ''}`)
  }

  /** Uploads a site (a `.tar.gz`); the query says what and where it is. */
  async uploadSite(
    query: Record<string, string>,
    archive: Uint8Array,
  ): Promise<ApiClient.SiteUpload> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/sites?${new URLSearchParams(query).toString()}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/gzip' },
        body: archive,
      },
    )
    const text = await res.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = undefined
    }
    if (!res.ok) {
      const message =
        typeof data === 'object' && data !== null && typeof Reflect.get(data, 'error') === 'string'
          ? String(Reflect.get(data, 'error'))
          : `HTTP ${res.status}`
      throw new ApiError(res.status, message, data)
    }
    // The server's tests pin this shape.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return data as ApiClient.SiteUpload
  }

  /** The commit a branch's address serves now, or null when it has none yet. */
  async servedCommit(name: string, branch: string): Promise<string | null> {
    const res = await this.json<{ commit: string | null }>(
      'GET',
      `/v1/sites/served?${new URLSearchParams({ name, branch }).toString()}`,
    )
    return res.commit
  }

  /** Sends one file as instructed by the server, retrying transient failures. */
  async upload(
    instruction: ApiClient.UploadInstruction,
    bytes: Uint8Array,
    attempts = 3,
  ): Promise<void> {
    // fetch sets content-length itself from the body; passing it explicitly is not allowed.
    const headers = Object.fromEntries(
      Object.entries(instruction.headers).filter(([k]) => k.toLowerCase() !== 'content-length'),
    )
    if (instruction.auth === 'token') headers.authorization = `Bearer ${this.token}`
    for (let attempt = 1; ; attempt += 1) {
      let res: Response | undefined
      let networkError: unknown
      try {
        // oxlint-disable-next-line no-await-in-loop -- retries are sequential by nature
        res = await this.fetchImpl(instruction.url, {
          method: instruction.method,
          headers,
          body: bytes,
        })
      } catch (err) {
        networkError = err
      }
      if (res?.ok) return
      const retryable = networkError !== undefined || (res !== undefined && res.status >= 500)
      if (!retryable || attempt >= attempts) {
        // oxlint-disable-next-line no-await-in-loop -- read the error body before giving up
        const detail = res ? `${res.status} ${await safeText(res)}` : String(networkError)
        throw new Error(`Upload of ${instruction.sha256.slice(0, 12)} failed: ${detail}`)
      }
      // oxlint-disable-next-line no-await-in-loop -- backoff between retries
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt))
    }
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
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
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}
