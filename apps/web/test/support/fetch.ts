import { vi } from 'vitest'

export interface FakeRequest {
  method: string
  path: string
  /** The query string with its "?" ("" when there is none). */
  search: string
  /** The address as asked: path and query. */
  href: string
  body: unknown
}

type Handler = unknown

/** A JSON response. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A promise settled from outside: `await` it in a handler (`holdUntil`), resolve it from the test. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** A request that never answers, to hold a page in its loading state. */
export const pending = () => new Promise<Response>(() => {})

/**
 * Replaces `fetch` (the network edge: the dashboard API and better-auth's `/api/auth`) with
 * answers keyed by "METHOD /path". A handler is a value (sent as JSON), a `Response`, or a function
 * of the request. Anything unlisted is a 404. Returns every request made, in order. Undo with
 * `restoreFetch()`.
 */
export function fakeFetch(
  routes: Record<string, Handler>,
  /** Answers what the table doesn't list (return `undefined` to leave it a 404): for an API shaped by patterns. */
  fallback?: (call: FakeRequest) => Handler,
): FakeRequest[] {
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
    const call = {
      method,
      path: url.pathname,
      search: url.search,
      href: url.pathname + url.search,
      body,
    }
    calls.push(call)
    const handler = routes[`${method} ${url.pathname}`] ?? fallback?.(call)
    if (handler === undefined) return json({ error: 'not found' }, 404)
    const answer: unknown = typeof handler === 'function' ? await handler(call) : handler
    return answer instanceof Response ? answer : json(answer)
  })
  return calls
}

/**
 * GET answers keyed by path alone, for a table that holds the answers of a whole app shell
 * (`'/api/capabilities': {...}`). It reads the table at request time, so a test may swap an answer
 * (`table[path] = ...`) after faking: `fakeFetch(getRoutes(TABLE))`.
 */
export function getRoutes(table: Record<string, unknown>): Record<string, Handler> {
  return Object.fromEntries(Object.keys(table).map((path) => [`GET ${path}`, () => table[path]]))
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
  /** Answers only once this settles (a slow network, without a timer): `deferred().promise`. */
  holdUntil?: Promise<unknown>
  /** Sent as the body, as is, instead of `body`'s JSON: for a deliberately malformed answer. */
  raw?: string
}
export type ReplyHandler = Reply | ((body: unknown) => Reply | Promise<Reply>)

/**
 * `fakeFetch` for the dashboard API, with replies shaped `{ status, body }` and handlers that get
 * the request body. `of(method)` lists the requests made with a method; `set` changes an answer.
 */
export function fakeApi(
  routes: Record<string, ReplyHandler>,
  /** Answers the requests the table doesn't list, by their address (return `undefined` for a 404). */
  fallback?: (call: FakeRequest) => ReplyHandler | undefined,
) {
  const table: Record<string, (call: FakeRequest) => Promise<Response>> = {}
  const wrap = (handler: ReplyHandler) => async (call: FakeRequest) => {
    const reply = await (typeof handler === 'function' ? handler(call.body) : handler)
    if (reply.holdUntil) await reply.holdUntil
    if (reply.status === 204) return new Response(null, { status: 204 })
    if (reply.raw !== undefined)
      return new Response(reply.raw, {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    return json(reply.body ?? {}, reply.status ?? 200)
  }
  for (const [key, handler] of Object.entries(routes)) table[key] = wrap(handler)
  const calls = fakeFetch(table, (call) => {
    const handler = fallback?.(call)
    return handler === undefined ? undefined : wrap(handler)
  })
  return {
    calls,
    /** Every address asked, path and query, in order (a fresh list each time it is read). */
    get urls() {
      return calls.map((call) => call.href)
    },
    of: (method: string) => calls.filter((c) => c.method === method),
    set: (key: string, handler: ReplyHandler) => {
      table[key] = wrap(handler)
    },
  }
}

/** The requests made while no fake answered them (see `installDefaultFetch`). */
const unfaked: string[] = []

/**
 * The `fetch` every test starts with: it answers nothing, so a request nobody faked fails loudly
 * with its method and URL instead of reaching the dev server. Installed by `setup.ts`; a test's own
 * `fakeFetch`/`fakeApi`/`hangingFetch` replaces it.
 */
export function installDefaultFetch() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const text = `${method} ${url}`
    unfaked.push(text)
    throw new Error(
      `Unfaked request: ${text}. Fake it with fakeFetch, fakeApi or renderPage({ api }).`,
    )
  })
}

/** The unfaked requests since the last call (and forgets them). */
export function takeUnfakedRequests(): string[] {
  return unfaked.splice(0)
}
