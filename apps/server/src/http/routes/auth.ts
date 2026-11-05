import type { Auth } from '@circi/auth'
import { fromNodeHeaders } from '@circi/auth'
import type { FastifyPluginAsync } from 'fastify'

/**
 * Hands `/api/auth/*` (sign in, sign out, session, organizations…) to better-auth. Fastify's
 * request becomes a Web `Request` built against the configured public origin, not the Host
 * header, so redirects and origin checks stay right behind a reverse proxy.
 */
export const authRoutes: FastifyPluginAsync<{ auth: Auth; publicOrigin: string }> = async (
  app,
  options,
) => {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, options.publicOrigin)
      const hasBody = request.method !== 'GET' && request.body !== undefined
      const response = await options.auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
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
