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
 * Hands `/api/auth/*` (sign in, sign out, session, workspaces…) to better-auth. Fastify's
 * request becomes a Web `Request` built against the configured public origin, not the Host
 * header, so redirects and origin checks stay right behind a reverse proxy.
 */
export const authRoutes: FastifyPluginAsync<{
  auth: Auth
  db: Database
  publicOrigin: string
  emailLogin: boolean
  passwordLogin: boolean
  sso: { id: string; name: string }[]
}> = async (app, options) => {
  /** What the sign-in page can offer. Public: it's needed before anyone is signed in. */
  app.get('/api/auth-methods', async () => ({
    password: options.passwordLogin,
    email: options.emailLogin,
    sso: options.sso,
    workspaceSso: await hasWorkspaceSso(options.db),
  }))

  // With email login off its endpoints disappear, rather than existing and doing nothing.
  if (!options.emailLogin) {
    app.all('/api/auth/email-otp/*', (_request, reply) => reply.callNotFound())
    app.all('/api/auth/sign-in/email-otp', (_request, reply) => reply.callNotFound())
  }

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, options.publicOrigin)
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
