import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * better-auth's browser client, talking to `/api/auth` on the same origin. Sessions are
 * httpOnly cookies the server sets, so nothing secret is ever readable from this code.
 */
export const authClient = createAuthClient({ basePath: '/api/auth', plugins: [emailOTPClient()] })

export type SessionUser = { id: string; name: string; email: string }
