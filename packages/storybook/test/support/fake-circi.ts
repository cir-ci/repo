import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: Buffer
}

/**
 * A stand-in for the CirCI `/v1` API (the parts an upload and a site upload use): a real HTTP server
 * on an ephemeral port, so the CLI's client runs against real sockets. Only CirCI itself is faked.
 */
export class FakeCirci {
  readonly requests: Recorded[] = []
  url = ''
  private server: Server | undefined

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

  to(prefix: string): Recorded[] {
    return this.requests.filter((r) => r.path.startsWith(prefix))
  }

  json(request: Pick<Recorded, 'body'>): Record<string, unknown> {
    const parsed: unknown = JSON.parse(request.body.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  }

  private route(method: string, url: URL, body: Buffer, res: ServerResponse) {
    const reply = (status: number, json?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(json === undefined ? '' : JSON.stringify(json))
    }
    const build = {
      id: 'b1',
      number: 7,
      name: 'storybook',
      status: 'processing',
      conclusion: null,
      reviewStatus: 'none',
      url: `${this.url}/builds/7`,
    }
    const path = url.pathname
    if (method === 'GET' && path === '/v1/project') {
      reply(200, {
        workspace: 'acme',
        slug: 'web',
        name: 'Web',
        defaultBranch: 'main',
        dashboardUrl: `${this.url}/acme/web`,
      })
    } else if (method === 'POST' && path === '/v1/builds') {
      const files = this.json({ body }).files
      const hashes = Array.isArray(files)
        ? files.flatMap((f: unknown) =>
            typeof f === 'object' && f !== null && 'sha256' in f && typeof f.sha256 === 'string'
              ? [f.sha256]
              : [],
          )
        : []
      reply(200, {
        build,
        uploads: hashes.map((sha256) => ({
          sha256,
          url: `${this.url}/files/${sha256}`,
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          auth: 'none',
        })),
      })
    } else if (method === 'PUT' && path.startsWith('/files/')) {
      reply(200)
    } else if (method === 'POST' && /^\/v1\/builds\/[^/]+\/finalize$/.test(path)) {
      reply(200, { build, complete: true, shardsReceived: 1, shardsTotal: 1 })
    } else if (method === 'GET' && /^\/v1\/builds\/[^/]+\/status$/.test(path)) {
      reply(200, {
        build: { ...build, status: 'complete' },
        counts: { added: 1, removed: 0, changed: 0, unchanged: 0, failed: 0, total: 1 },
        unreadable: [],
        outcome: { state: 'pass', summary: 'All clear' },
        gate: 'exit-code',
        errorMessage: null,
      })
    } else if (method === 'GET' && path === '/v1/sites/served') {
      reply(200, { commit: null })
    } else if (method === 'POST' && path === '/v1/sites') {
      reply(200, {
        site: { name: url.searchParams.get('name') ?? 'site', kind: 'storybook', slug: 'web' },
        version: { commitSha: url.searchParams.get('commit') ?? '', fileCount: 2, totalBytes: 10 },
        addresses: { commit: 'https://abc-web.sites.test' },
        branchMoved: false,
        replaced: false,
      })
    } else {
      reply(404, { error: `no route ${method} ${path}` })
    }
  }
}
