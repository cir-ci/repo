import { emailOTPClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * better-auth's browser client, talking to `/api/auth` on the same origin. Sessions are
 * httpOnly cookies the server sets, so nothing secret is ever readable from this code.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  // Looks `fetch` up per request (not once at creation), so tests can stub it after this loads.
  fetchOptions: { customFetchImpl: (...args) => fetch(...args) },
  plugins: [emailOTPClient(), organizationClient()],
})

/** The parts of the session the shell uses. Whether the person runs the instance comes from `/api/capabilities`. */
export type SessionUser = { id: string; name: string; email: string; image: string | null }
