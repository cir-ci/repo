import { getSessionMethod, orgAcceptsSession, schema, takeEmailCodeSlot } from '@circi/db'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { eq } from 'drizzle-orm'

import type { AuthOptions } from '../options.ts'

/** The organization a request names, by id or slug. */
function organizationRef(source: unknown): { id?: string; slug?: string } | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const id: unknown = Reflect.get(source, 'organizationId')
  const slug: unknown = Reflect.get(source, 'organizationSlug')
  if (typeof id === 'string' && id) return { id }
  if (typeof slug === 'string' && slug) return { slug }
  return undefined
}

/**
 * Runs before better-auth handles a request:
 *
 * - sign-in code requests are limited per address, on top of better-auth's per-IP limit;
 * - better-auth's own organization endpoints (members, invitations) obey an organization's
 *   login-method rules like the rest of the dashboard: a refused session gets "not found".
 */
export function requestGuard(options: Pick<AuthOptions, 'db'>) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === '/email-otp/send-verification-otp') {
      // Counted for every address, so refusing never reveals which ones have accounts.
      const email = typeof ctx.body?.email === 'string' ? ctx.body.email : ''
      if (email && !(await takeEmailCodeSlot(options.db, email))) {
        throw new APIError('TOO_MANY_REQUESTS', {
          message: 'Too many sign-in codes requested for this address. Try again later.',
        })
      }
      return
    }
    if (!ctx.path.startsWith('/organization/')) return
    const ref = organizationRef(ctx.body) ?? organizationRef(ctx.query)
    if (!ref) return
    const session = await getSessionFromCtx(ctx)
    if (!session) return
    const [org] = await options.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(
        ref.id ? eq(schema.organization.id, ref.id) : eq(schema.organization.slug, ref.slug ?? ''),
      )
    if (!org) return
    const method = (await getSessionMethod(options.db, session.session.id)) ?? 'unknown'
    if (!(await orgAcceptsSession(options.db, org.id, method))) {
      throw new APIError('NOT_FOUND', { message: 'Organization not found' })
    }
  })
}
