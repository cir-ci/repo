import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { ORIGIN, signIn } from './helpers.ts'

/** What a browser sends with a JSON write: the dashboard's origin (same-origin check) and type. */
export const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' } as const

export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** One identity talking to one app. `cookie` is '' for nobody. */
export interface Client {
  cookie: string
  get(url: string): Promise<LightMyRequestResponse>
  /** The body is sent as JSON (with its content type) only when given. */
  send(method: WriteMethod, url: string, body?: unknown): Promise<LightMyRequestResponse>
  /** The same app as another identity. */
  as(cookie: string): Client
  /** The same app with no session. */
  anonymous: Client
}

export function clientFor(app: FastifyInstance, cookie: string | undefined = ''): Client {
  const client: Client = {
    cookie,
    get: (url) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} }),
    send: (method, url, body) =>
      app.inject({
        method,
        url,
        headers: {
          origin: ORIGIN,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      }),
    as: (other) => clientFor(app, other),
    get anonymous() {
      return cookie === '' ? client : clientFor(app, '')
    },
  }
  return client
}

/** An app, or a function giving it for tests that build it in `beforeAll`. */
export type AppRef = FastifyInstance | (() => FastifyInstance)
const resolve = (app: AppRef) => (typeof app === 'function' ? app() : app)

/** Signs in through the server's own `/api/auth` route. */
export async function signedInClient(
  app: FastifyInstance,
  who: { email: string; password: string },
): Promise<Client> {
  return clientFor(app, await signIn(app, who.email, who.password))
}

/**
 * The `(method, url, cookie, body?)` request function many route tests use: one call, any
 * identity (`''` for none), JSON only when there is a body.
 */
export function caller(app: AppRef) {
  return (method: 'GET' | WriteMethod, url: string, cookie: string | undefined, body?: unknown) =>
    method === 'GET'
      ? clientFor(resolve(app), cookie).get(url)
      : clientFor(resolve(app), cookie).send(method, url, body)
}

/**
 * The `(method, url, { cookie, payload, origin })` request function of the review-style tests:
 * writes carry a JSON body (`{}` by default; none for DELETE) and the origin, as a browser's do.
 * `cookie` defaults to `defaultCookie`; `''` sends none; `origin: null` leaves the header out.
 */
export function sender(appRef: AppRef, defaultCookie: string) {
  return (
    method: WriteMethod,
    url: string,
    options: { cookie?: string; payload?: unknown; origin?: string | null } = {},
  ) =>
    resolve(appRef).inject({
      method,
      url,
      headers: {
        ...(method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
        ...(options.cookie === '' ? {} : { cookie: options.cookie ?? defaultCookie }),
        ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
      },
      ...(method === 'DELETE' ? {} : { payload: options.payload ?? {} }),
    })
}
