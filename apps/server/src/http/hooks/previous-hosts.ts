import type { onRequestHookHandler } from 'fastify'

/**
 * After the dashboard moves (PUBLIC_URL changed), old links keep working: requests to a previous
 * host get a 308 to the same path on the current origin. 308 keeps the method and body, so API
 * clients still pointed at the old host follow it too (PLAN §7.9).
 */
export function redirectPreviousHosts(hosts: string[], origin: string): onRequestHookHandler {
  const previous = new Set(hosts.map((h) => h.toLowerCase()))
  return (req, reply, done) => {
    if (previous.has(req.host.toLowerCase())) {
      // Sending a reply ends the request; `done` must not be called as well.
      void reply.redirect(`${origin}${req.url}`, 308)
      return
    }
    done()
  }
}
