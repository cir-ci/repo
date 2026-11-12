import type { IncomingMessage } from 'node:http'

import { listen, readBody } from './http.ts'

/**
 * A fault-injecting HTTP proxy in front of a real server, for tests of clients that must survive a
 * flaky network (the CLI's retries). Everything is forwarded as it came, and the answers come back
 * untouched, except where a rule says otherwise:
 *
 * - `dropAfter`: the request IS forwarded and the server handles it (and commits), then the
 *   connection to the client is cut before any answer: the "lost response" a gateway timeout causes.
 * - `status`: the request is NOT forwarded and the client gets this status instead (a 502 from a
 *   gateway in front of the server).
 *
 * Every request is recorded with what the server answered, so a test can see what was resent.
 */
export namespace startFaultProxy {
  export interface Seen {
    method: string
    /** Path and query. */
    url: string
    headers: IncomingMessage['headers']
    body: string
    /** What the server answered, or undefined when it was never asked. */
    upstreamStatus: number | undefined
    upstreamBody: string | undefined
    /** What the client got: the server's status, the injected one, or `dropped`. */
    outcome: number | 'dropped'
  }

  export interface Rule {
    /** Which requests it applies to. */
    match: (request: { method: string; url: string }) => boolean
    /** How many times it fires; then it is spent. Default 1. */
    times?: number
    fault: { dropAfter: true } | { status: number }
  }
}

export interface FaultProxy {
  /** Where clients point: `http://127.0.0.1:<port>`. */
  url: string
  /** Everything that reached the proxy, in order. */
  readonly requests: readonly startFaultProxy.Seen[]
  /** Adds a rule; rules are tried in the order they were added, the first live match wins. */
  inject(rule: startFaultProxy.Rule): void
  /** Forgets rules and the record. */
  reset(): void
  close(): Promise<void>
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

export async function startFaultProxy(target: string): Promise<FaultProxy> {
  const requests: startFaultProxy.Seen[] = []
  let rules: { rule: startFaultProxy.Rule; left: number }[] = []
  const base = target.replace(/\/+$/, '')

  const server = await listen((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET'
      const url = req.url ?? '/'
      const body = await readBody(req)
      const seen: startFaultProxy.Seen = {
        method,
        url,
        headers: req.headers,
        body: body.toString('utf8'),
        upstreamStatus: undefined,
        upstreamBody: undefined,
        outcome: 'dropped',
      }
      requests.push(seen)
      const fired = rules.find((r) => r.left > 0 && r.rule.match({ method, url }))
      if (fired) fired.left -= 1
      const fault = fired?.rule.fault
      if (fault && 'status' in fault) {
        seen.outcome = fault.status
        res.statusCode = fault.status
        res.setHeader('content-type', 'text/plain')
        res.end('Bad Gateway')
        return
      }
      try {
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
          if (HOP_BY_HOP.has(key) || value === undefined) continue
          headers[key] = Array.isArray(value) ? value.join(', ') : value
        }
        const upstream = await fetch(`${base}${url}`, {
          method,
          headers,
          ...(method === 'GET' || method === 'HEAD' ? {} : { body: new Uint8Array(body) }),
          redirect: 'manual',
        })
        const answer = Buffer.from(await upstream.arrayBuffer())
        seen.upstreamStatus = upstream.status
        seen.upstreamBody = answer.toString('utf8')
        if (fault && 'dropAfter' in fault) {
          // The server has answered and committed; the client never hears it.
          req.socket.destroy()
          return
        }
        seen.outcome = upstream.status
        res.statusCode = upstream.status
        upstream.headers.forEach((value, key) => {
          if (!HOP_BY_HOP.has(key) && key !== 'content-encoding') res.setHeader(key, value)
        })
        res.end(answer)
      } catch {
        req.socket.destroy()
      }
    })()
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    inject(rule) {
      rules.push({ rule, left: rule.times ?? 1 })
    },
    reset() {
      rules = []
      requests.length = 0
    },
    close: () => server.close(),
  }
}
