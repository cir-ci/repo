import { vi } from 'vitest'

export interface FakeRequest {
  method: string
  path: string
  body: unknown
}

type Handler = unknown

/** A JSON response. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A request that never answers, to hold a page in its loading state. */
export const pending = () => new Promise<Response>(() => {})

/**
 * Replaces `fetch` (the network edge: the dashboard API and better-auth's `/api/auth`) with
 * answers keyed by "METHOD /path". A handler is a value (sent as JSON), a `Response`, or a function
 * of the request. Anything unlisted is a 404. Returns every request made, in order. Undo with
 * `restoreFetch()`.
 */
export function fakeFetch(routes: Record<string, Handler>): FakeRequest[] {
  const calls: FakeRequest[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const url = new URL(
      request?.url ?? (typeof input === 'string' ? input : input instanceof URL ? input.href : ''),
      'http://localhost',
    )
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const raw = init?.body ?? (request ? await request.text() : undefined)
    let body: unknown = undefined
    if (typeof raw === 'string' && raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }
    const call = { method, path: url.pathname, body }
    calls.push(call)
    const handler = routes[`${method} ${url.pathname}`]
    if (handler === undefined) return json({ error: 'not found' }, 404)
    const answer: unknown = typeof handler === 'function' ? await handler(call) : handler
    return answer instanceof Response ? answer : json(answer)
  })
  return calls
}

/** Back to the real network (call after each test). */
export const restoreFetch = () => {
  vi.unstubAllGlobals()
}

/** A request that never answers: every request leaves the page in its loading state. */
export function hangingFetch() {
  vi.stubGlobal('fetch', () => pending())
}

/** A reply: a JSON body (200 unless `status` says otherwise; 204 has none). */
export interface Reply {
  status?: number
  body?: unknown
}
export type ReplyHandler = Reply | ((body: unknown) => Reply)

/**
 * `fakeFetch` for the dashboard API, with replies shaped `{ status, body }` and handlers that get
 * the request body. `of(method)` lists the requests made with a method; `set` changes an answer.
 */
export function fakeApi(routes: Record<string, ReplyHandler>) {
  const table: Record<string, (call: FakeRequest) => Response> = {}
  const wrap = (handler: ReplyHandler) => (call: FakeRequest) => {
    const reply = typeof handler === 'function' ? handler(call.body) : handler
    if (reply.status === 204) return new Response(null, { status: 204 })
    return json(reply.body ?? {}, reply.status ?? 200)
  }
  for (const [key, handler] of Object.entries(routes)) table[key] = wrap(handler)
  const calls = fakeFetch(table)
  return {
    calls,
    of: (method: string) => calls.filter((c) => c.method === method),
    set: (key: string, handler: ReplyHandler) => {
      table[key] = wrap(handler)
    },
  }
}
