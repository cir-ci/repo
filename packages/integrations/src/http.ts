/**
 * The one HTTP client the provider adapters share: base URL, headers, JSON in and out, a timeout,
 * and one `fail` hook per adapter that turns a non-2xx answer into that adapter's error. It holds
 * no credentials: auth headers are given per client or per request. `fetch` is injectable.
 */

export interface HttpFailure {
  status: number
  statusText: string
  /** The parsed JSON body; `undefined` when empty or not JSON. */
  data: unknown
  /** The body as received. */
  text: string
  headers: Headers
  method: string
  path: string
}

export interface HttpResponse {
  status: number
  statusText: string
  /** The parsed JSON body; `undefined` when empty or not JSON. */
  data: unknown
  headers: Headers
}

export interface HttpRequestOptions {
  /** Sent as JSON. */
  body?: unknown
  /** Sent as `application/x-www-form-urlencoded` (ignored when `body` is given). */
  form?: Record<string, string>
  /** Merged over the client's headers. */
  headers?: Record<string, string>
  /** Overrides the client's timeout; 0 means none. */
  timeoutMs?: number
}

export interface HttpClient {
  request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResponse>
}

export interface HttpClientOptions {
  /** Prepended to every path, no trailing slash handling: pass it clean. */
  baseUrl: string
  fetch?: typeof fetch
  /** Sent on every request. `user-agent: CirCI` is the default. */
  headers?: Record<string, string>
  /** Default 15 000; 0 means no timeout. */
  timeoutMs?: number
  /** The error for a non-2xx answer. Called instead of returning the response. */
  fail: (failure: HttpFailure) => Error
  /** The error for a request that never got an answer (DNS, refused, timeout). Default: rethrow. */
  unreachable?: (err: unknown) => Error
}

export const DEFAULT_TIMEOUT_MS = 15_000

/** A body read as JSON, or `undefined` when it is empty or not JSON. */
export function parseJsonSafely(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

/** The first of `keys` that is a string field of `data`, else `HTTP <status>`. */
export function apiMessage(data: unknown, status: number, ...keys: string[]): string {
  if (typeof data === 'object' && data !== null) {
    for (const key of keys) {
      const value: unknown = Reflect.get(data, key)
      if (typeof value === 'string') return value
    }
  }
  return `HTTP ${status}`
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  return {
    async request(method, path, request = {}) {
      const headers: Record<string, string> = {
        'user-agent': 'CirCI',
        ...options.headers,
        ...request.headers,
      }
      let body: string | undefined
      if (request.body !== undefined) {
        headers['content-type'] ??= 'application/json'
        body = JSON.stringify(request.body)
      } else if (request.form) {
        headers['content-type'] ??= 'application/x-www-form-urlencoded'
        body = new URLSearchParams(request.form).toString()
      }
      const timeoutMs = request.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let res: Response
      try {
        res = await (options.fetch ?? fetch)(`${options.baseUrl}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        })
      } catch (err) {
        throw options.unreachable ? options.unreachable(err) : err
      }
      const text = await res.text()
      const data = parseJsonSafely(text)
      if (!res.ok) {
        throw options.fail({
          status: res.status,
          statusText: res.statusText,
          data,
          text,
          headers: res.headers,
          method,
          path,
        })
      }
      return { status: res.status, statusText: res.statusText, data, headers: res.headers }
    },
  }
}
