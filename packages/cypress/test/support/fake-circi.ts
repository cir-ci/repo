import { createServer, type Server, type ServerResponse } from 'node:http'

export interface Recorded {
  method: string
  path: string
  body: Buffer
}

/**
 * A stand-in for the CirCI `/v1` API: a real HTTP server on an ephemeral port, so the upload code
 * that runs inside Cypress's own process talks to real sockets and only CirCI itself is faked.
 * The real server is not involved: this proves what the plugin sends, not how CirCI answers.
 */
export class FakeCirci {
  readonly requests: Recorded[] = []
  url = ''
  private server: Server | undefined
  /** `GET /v1/builds/:id/status` answers this outcome. */
  outcome: 'pass' | 'fail' = 'pass'

  async start(): Promise<this> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://fake')
        const body = Buffer.concat(chunks)
        this.requests.push({ method: req.method ?? 'GET', path: url.pathname, body })
        this.route(req.method ?? 'GET', url.pathname, body, res)
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

  /** The JSON body of the (first) request to `POST path`. */
  json(method: string, path: string): Record<string, unknown> | undefined {
    const found = this.requests.find((r) => r.method === method && r.path === path)
    if (!found) return undefined
    const parsed: unknown = JSON.parse(found.body.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : undefined
  }

  /** The files PUT to the (fake) storage, by hash. */
  uploads(): Map<string, Buffer> {
    return new Map(
      this.requests
        .filter((r) => r.method === 'PUT' && r.path.startsWith('/files/'))
        .map((r) => [r.path.slice('/files/'.length), r.body]),
    )
  }

  private build() {
    return {
      id: 'b1',
      number: 7,
      name: 'cypress-fixture',
      status: 'processing',
      conclusion: null,
      reviewStatus: 'none',
      url: `${this.url}/builds/7`,
    }
  }

  private route(method: string, path: string, body: Buffer, res: ServerResponse) {
    const reply = (status: number, json?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(json === undefined ? '' : JSON.stringify(json))
    }
    if (method === 'GET' && path === '/v1/project') {
      reply(200, {
        workspace: 'acme',
        slug: 'web',
        name: 'Web',
        defaultBranch: 'main',
        dashboardUrl: `${this.url}/acme/web`,
      })
    } else if (method === 'POST' && path === '/v1/builds') {
      const parsed: unknown = JSON.parse(body.toString('utf8'))
      const files =
        typeof parsed === 'object' &&
        parsed !== null &&
        'files' in parsed &&
        Array.isArray(parsed.files)
          ? parsed.files
          : []
      const hashes: string[] = files.flatMap((f: unknown) =>
        typeof f === 'object' && f !== null && 'sha256' in f && typeof f.sha256 === 'string'
          ? [f.sha256]
          : [],
      )
      reply(200, {
        build: this.build(),
        uploads: [...new Set(hashes)].map((sha256) => ({
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
      reply(200, { build: this.build(), complete: true, shardsReceived: 1, shardsTotal: 1 })
    } else if (method === 'GET' && /^\/v1\/builds\/[^/]+\/status$/.test(path)) {
      reply(200, {
        build: { ...this.build(), status: 'complete' },
        counts: { added: 0, removed: 0, changed: 1, unchanged: 2, failed: 0, total: 3 },
        unreadable: [],
        outcome: {
          state: this.outcome,
          summary: this.outcome === 'pass' ? 'All clear' : 'Changes found',
        },
        gate: 'exit-code',
        errorMessage: null,
      })
    } else {
      reply(404, { error: `no route ${method} ${path}` })
    }
  }
}
