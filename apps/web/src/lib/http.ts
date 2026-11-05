/** The dashboard API's fetch wrapper: JSON in and out, errors as `HttpError`. */

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body: unknown = await res.json()
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'string'
      ) {
        message = body.error
      }
    } catch {
      // Non-JSON error body: keep the status line.
    }
    throw new HttpError(res.status, message)
  }
  // No-content answers (deletes) carry nothing to parse; callers of those ask for `undefined`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  if (res.status === 204) return undefined as T
  // The shapes come from `@circi/api`, which the server checks its read models against.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (await res.json()) as T
}

export const getJson = <T>(path: string) => request<T>(path)

export const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const send = <T>(method: 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

/** A path segment, escaped. */
export const seg = encodeURIComponent
