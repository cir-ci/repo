import { vi } from 'vitest'

/** The one JSON `Response` builder every fake host uses. */
export const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status })

export interface RecordedCall {
  method: string
  /** The host, with a port when there is one. */
  host: string
  /** The pathname, without the query. */
  path: string
  /** The query string with its leading `?`, or `''`. */
  query: string
  headers: Record<string, string>
  /** The parsed JSON body, the raw text when it is not JSON, or `undefined` without one. */
  body: unknown
}

/** What every fake of an external service's HTTP edge offers, whatever it simulates. */
export interface FakeHost {
  /** Hand this to the adapter as its `fetch`. */
  fetcher: typeof fetch
  /** Every request received, in order. */
  calls: RecordedCall[]
  /**
   * Queue answers for a route, `"METHOD /path"` (or `"METHOD /path?query"`): each request to it
   * takes the next answer (a `Response`, an `Error` to throw, or any other value sent as JSON),
   * and once the answers are used up the host's own behaviour answers.
   */
  script(route: string, ...answers: unknown[]): this
  /** Replaces the global `fetch` with `fetcher`; returns what restores it. */
  stub(): () => void
}

/**
 * Wraps a host's behaviour (`behaviour`: how it answers when nothing is scripted) so it records
 * its calls and takes scripted answers. Without a behaviour every unscripted request is a 500.
 */
export function fakeHost(behaviour?: typeof fetch): FakeHost {
  const calls: RecordedCall[] = []
  const scripts = new Map<string, unknown[]>()

  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const text = await req.clone().text()
    let body: unknown
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    calls.push({
      method: req.method,
      host: url.host,
      path: url.pathname,
      query: url.search,
      headers: Object.fromEntries(req.headers),
      body,
    })
    const queued =
      scripts.get(`${req.method} ${url.pathname}${url.search}`) ??
      scripts.get(`${req.method} ${url.pathname}`)
    if (queued && queued.length > 0) {
      const answer = queued.shift()
      if (answer instanceof Error) throw answer
      return answer instanceof Response ? answer : jsonResponse(answer)
    }
    if (behaviour) return behaviour(input, init)
    return jsonResponse({ message: 'unscripted' }, 500)
  }

  const host: FakeHost = {
    fetcher,
    calls,
    script(route, ...answers) {
      scripts.set(route, [...(scripts.get(route) ?? []), ...answers])
      return host
    },
    stub() {
      vi.stubGlobal('fetch', fetcher)
      return () => vi.unstubAllGlobals()
    },
  }
  return host
}
