import type { Auth } from '@circi/auth'
import { fromNodeHeaders } from '@circi/auth'
import { describeAuthValidation } from '@circi/core'
import type { Database } from '@circi/db'
import { hasWorkspaceSso } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'

/**
 * better-auth's validation failures carry developer text (`[body.email] Invalid input: …`). They
 * become the app routes' shape, `{ error, fields }`, keeping better-auth's own `message` and
 * `code` for its client. Any other body goes through untouched.
 */
function readableValidation(text: string) {
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body !== 'object' || body === null) return text
    if (Reflect.get(body, 'code') !== 'VALIDATION_ERROR') return text
    const raw: unknown = Reflect.get(body, 'message')
    const problem = typeof raw === 'string' ? describeAuthValidation(raw) : undefined
    if (!problem) return text
    return JSON.stringify({
      ...body,
      message: problem.error,
      error: problem.error,
      fields: problem.fields,
    })
  } catch {
    return text
  }
}

/**
 * The email-code paths of better-auth's `email-otp` plugin that the dashboard uses: they exist
 * only while email codes are offered. The plugin has more (`/forget-password/email-otp`,
 * `/email-otp/request-password-reset`, `/email-otp/verify-email`, `/email-otp/change-email`, …):
 * nothing in CirCI calls them, so they never exist, rather than being reachable and doing
 * something CirCI didn't plan for.
 */
const EMAIL_CODE_PATHS: ReadonlySet<string> = new Set([
  '/email-otp/send-verification-otp',
  '/sign-in/email-otp',
])

/** Whether a path (below `/api/auth`) belongs to the `email-otp` plugin. */
function isEmailOtpPath(path: string): boolean {
  return (
    path.startsWith('/email-otp/') ||
    path === '/sign-in/email-otp' ||
    path === '/forget-password/email-otp'
  )
}

/**
 * Hands `/api/auth/*` (sign in, sign out, session, workspaces…) to better-auth. Fastify's
 * request becomes a Web `Request` built against the configured public origin, not the Host
 * header, so redirects and origin checks stay right behind a reverse proxy.
 */
export const authRoutes: FastifyPluginAsync<{
  auth: Auth
  db: Database
  publicOrigin: string
  /** What the sign-in page offers, read per request (the instance settings can change). */
  methods: () => Promise<{
    password: boolean
    email: boolean
    sso: { id: string; name: string }[]
  }>
}> = async (app, options) => {
  /** What the sign-in page can offer. Public: it's needed before anyone is signed in. */
  app.get('/api/auth-methods', async () => ({
    ...(await options.methods()),
    workspaceSso: await hasWorkspaceSso(options.db),
  }))

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, options.publicOrigin)
      // Email-code endpoints exist only for the paths the dashboard uses, and only with email
      // login on; every other path of the plugin is not found.
      const path = url.pathname.slice('/api/auth'.length)
      if (
        isEmailOtpPath(path) &&
        (!EMAIL_CODE_PATHS.has(path) || !(await options.methods()).email)
      ) {
        return reply.callNotFound()
      }
      const hasBody = request.method !== 'GET' && request.body !== undefined
      // better-auth keys its rate limits and session records on `X-Forwarded-For`. Whatever the
      // client sent is replaced by the address Fastify resolved (the socket, or the forwarded
      // chain through the configured trusted proxies), so a forged header changes nothing.
      const headers = fromNodeHeaders(request.headers)
      headers.set('x-forwarded-for', request.ip)
      headers.delete('x-real-ip')
      const response = await options.auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        }),
      )
      reply.status(response.status)
      // Set-Cookie can repeat, and must not be folded into one header.
      for (const cookie of response.headers.getSetCookie()) reply.header('set-cookie', cookie)
      response.headers.forEach((value, key) => {
        // The length is the original body's; the body may have been rewritten.
        if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value)
      })
      const text = response.body ? await response.text() : null
      return reply.send(response.status === 400 && text ? readableValidation(text) : text)
    },
  })
}
