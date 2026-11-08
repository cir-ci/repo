import type { Auth } from '@circi/auth'
import { fromNodeHeaders } from '@circi/auth'
import type { FastifyPluginAsync } from 'fastify'

/**
 * Hands `/api/auth/*` (sign in, sign out, session, workspaces…) to better-auth. Fastify's
 * request becomes a Web `Request` built against the configured public origin, not the Host
 * header, so redirects and origin checks stay right behind a reverse proxy.
 */
export const authRoutes: FastifyPluginAsync<{
  auth: Auth
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
        if (key !== 'set-cookie') reply.header(key, value)
      })
      return reply.send(response.body ? await response.text() : null)
    },
  })
}
