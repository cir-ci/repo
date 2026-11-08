import { getSessionMethod, workspaceAcceptsSession, schema, takeEmailCodeSlot } from '@circi/db'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { eq } from 'drizzle-orm'

import type { AuthOptions } from '#src/options.ts'

/** The workspace a request names, by id or slug. */
function workspaceRef(source: unknown): { id?: string; slug?: string } | undefined {
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
 * - better-auth's own organization endpoints (CirCI's workspaces: members, invitations) obey a workspace's
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
    const ref = workspaceRef(ctx.body) ?? workspaceRef(ctx.query)
    if (!ref) return
    const session = await getSessionFromCtx(ctx)
    if (!session) return
    const [workspace] = await options.db
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(ref.id ? eq(schema.workspace.id, ref.id) : eq(schema.workspace.slug, ref.slug ?? ''))
    if (!workspace) return
    const method = (await getSessionMethod(options.db, session.session.id)) ?? 'unknown'
    if (!(await workspaceAcceptsSession(options.db, workspace.id, method))) {
      throw new APIError('NOT_FOUND', { message: 'Workspace not found' })
    }
  })
}
