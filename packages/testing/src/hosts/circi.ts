import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: Buffer
}

export interface FakeCirciOptions {
  /** What `GET /v1/project` returns. */
  defaultBranch?: string
  /** Outcome states returned by `GET /v1/builds/:id/status`, one per poll (the last repeats). */
  outcomes?: ('pending' | 'pass' | 'fail')[]
  /** The same answer on every poll: shorthand for `outcomes: [outcome]`. */
  outcome?: 'pass' | 'fail'
  /** What `GET /v1/builds/:id/status` says about who gates the merge. */
  gate?: 'exit-code' | 'status'
  /** The first finalize answers 409 asking for these files again. */
  missingOnFirstFinalize?: boolean
  /** `GET /v1/sites/served` answers this. */
  servedCommit?: string | null
  /** The first N file uploads fail with 503. */
  failUploads?: number
  /** `POST /v1/sites` answers this status instead of 200. */
  siteStatus?: number
  /** The build's status in `GET /v1/builds/:id/status` (default `complete`, or `processing` while pending). */
  buildStatus?: string
  /** `errorMessage` in that answer. */
  errorMessage?: string | null
  /** Screenshots the server couldn't read: counted as failed, listed in `unreadable`. */
  unreadable?: { name: string; reason: string }[]
  /**
   * The first `times` requests whose `METHOD path` starts with `match` answer `status` (an error
   * body) before the route runs; status 0 drops the connection instead.
   */
  failFirst?: { match: string; status: number; times: number }[]
}

/**
 * A stand-in for the CirCI `/v1` API: a real HTTP server on an ephemeral port, so the CLI's
 * client runs against real sockets and only the CirCI server itself is faked.
 */
export class FakeCirci {
  readonly requests: Recorded[] = []
  url = ''
  private server: Server | undefined
  private polls = 0
  private finalizes = 0
  private failedUploads = 0
  private pending: string[] = []
  private failed = new Map<string, number>()

  private readonly options: FakeCirciOptions

  constructor(options: FakeCirciOptions = {}) {
    this.options = options
  }

  async start(): Promise<this> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const url = new URL(req.url ?? '/', 'http://fake')
        this.requests.push({
          method: req.method ?? 'GET',
          path: url.pathname + url.search,
          headers: req.headers,
          body,
        })
        this.route(req.method ?? 'GET', url, body, res)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    this.server = server
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no listening port')
    this.url = `http://127.0.0.1:${address.port}`
    return this
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  /** Requests whose path starts with `prefix`. */
  to(prefix: string): Recorded[] {
    return this.requests.filter((r) => r.path.startsWith(prefix))
  }

  /** The file uploads (`PUT /files/<sha256>`) received so far. */
  uploads(): Recorded[] {
    return this.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/files/'))
  }

  /** The JSON body of a recorded request, or of the first one to `path` (a prefix) with `method`. */
  json(request: Pick<Recorded, 'body'>): Record<string, unknown>
  json(method: string, path: string): Record<string, unknown>
  json(first: Pick<Recorded, 'body'> | string, path?: string): Record<string, unknown> {
    const request =
      typeof first === 'string'
        ? this.requests.find((r) => r.method === first && r.path.startsWith(path ?? ''))
        : first
    if (!request)
      throw new Error(
        `no ${typeof first === 'string' ? first : 'such'} request${path ? ` to ${path}` : ''}`,
      )
    const parsed: unknown = JSON.parse(request.body.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  }

  private build() {
    return {
      id: 'b1',
      number: 7,
      name: 'default',
      status: 'processing',
      conclusion: null,
      reviewStatus: 'none',
      url: `${this.url}/builds/7`,
    }
  }

  private route(method: string, url: URL, body: Buffer, res: ServerResponse) {
    for (const rule of this.options.failFirst ?? []) {
      const key = `${rule.match}|${rule.status}`
      if (!`${method} ${url.pathname}`.startsWith(rule.match)) continue
      const count = this.failed.get(key) ?? 0
      if (count >= rule.times) continue
      this.failed.set(key, count + 1)
      if (rule.status === 0) {
        res.socket?.destroy()
      } else {
        res.writeHead(rule.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: `injected ${rule.status}` }))
      }
      return
    }
    const reply = (status: number, json?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(json === undefined ? '' : JSON.stringify(json))
    }
    const path = url.pathname
    if (method === 'GET' && path === '/v1/project') {
      reply(200, {
        workspace: 'acme',
        slug: 'web',
        name: 'Web',
        defaultBranch: this.options.defaultBranch ?? 'main',
        dashboardUrl: `${this.url}/acme/web`,
      })
    } else if (method === 'POST' && path === '/v1/builds') {
      const files = hashesIn(body)
      // The server already has the first file, when there are several: it is deduplicated.
      const wanted = files.length > 1 ? files.slice(1) : files
      this.pending = wanted
      reply(200, {
        build: this.build(),
        uploads: wanted.map((sha256) => ({
          sha256,
          url: `${this.url}/files/${sha256}`,
          method: 'PUT',
          headers: { 'content-type': 'image/png', 'content-length': '3' },
          auth: 'none',
        })),
      })
    } else if (method === 'PUT' && path.startsWith('/files/')) {
      if (this.failedUploads < (this.options.failUploads ?? 0)) {
        this.failedUploads += 1
        reply(503, { error: 'storage hiccup' })
      } else reply(200)
    } else if (method === 'POST' && /^\/v1\/builds\/[^/]+\/finalize$/.test(path)) {
      this.finalizes += 1
      if (this.options.missingOnFirstFinalize && this.finalizes === 1) {
        reply(409, { error: 'files missing', missing: this.pending })
      } else {
        reply(200, { build: this.build(), complete: true, shardsReceived: 1, shardsTotal: 1 })
      }
    } else if (method === 'GET' && /^\/v1\/builds\/[^/]+\/status$/.test(path)) {
      const outcomes = this.options.outcomes ?? [this.options.outcome ?? 'pass']
      const state = outcomes[Math.min(this.polls, outcomes.length - 1)] ?? 'pass'
      this.polls += 1
      reply(200, {
        build: {
          ...this.build(),
          status: this.options.buildStatus ?? (state === 'pending' ? 'processing' : 'complete'),
        },
        counts: {
          added: 1,
          removed: 0,
          changed: 2,
          unchanged: 3,
          failed: this.options.unreadable?.length ?? 0,
          total: 6,
        },
        unreadable: this.options.unreadable ?? [],
        outcome: { state, summary: state === 'pass' ? 'All clear' : 'Changes found' },
        gate: this.options.gate ?? 'exit-code',
        errorMessage: this.options.errorMessage ?? null,
      })
    } else if (method === 'GET' && path === '/v1/sites/served') {
      reply(200, { commit: this.options.servedCommit ?? null })
    } else if (method === 'POST' && path === '/v1/sites') {
      const status = this.options.siteStatus ?? 200
      if (status !== 200) {
        reply(status, { error: 'That site is too big' })
        return
      }
      const branch = url.searchParams.get('branch')
      reply(200, {
        site: { name: url.searchParams.get('name') ?? 'site', kind: 'storybook', slug: 'web' },
        version: { commitSha: url.searchParams.get('commit') ?? '', fileCount: 2, totalBytes: 10 },
        addresses: {
          commit: 'https://abc-web.sites.test',
          ...(branch ? { branch: 'https://main-web.sites.test' } : {}),
        },
        branchMoved: branch !== null,
        replaced: false,
      })
    } else {
      reply(404, { error: `no route ${method} ${path}` })
    }
  }
}

/** The `sha256` of each file in a create-build request body. */
function hashesIn(body: Buffer): string[] {
  const parsed: unknown = JSON.parse(body.toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('files' in parsed)) return []
  if (!Array.isArray(parsed.files)) return []
  return parsed.files.flatMap((f: unknown) =>
    typeof f === 'object' && f !== null && 'sha256' in f && typeof f.sha256 === 'string'
      ? [f.sha256]
      : [],
  )
}
