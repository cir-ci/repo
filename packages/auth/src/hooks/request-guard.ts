import {
  getSessionMethod,
  isInstanceAdmin,
  providerRefusal,
  workspaceAcceptsSession,
} from '@circi/db/queries'
import { takeEmailCodeSlot } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { eq } from 'drizzle-orm'

import type { AuthOptions } from '#src/options.ts'

import { rememberOpenInvitations } from './invitations.ts'
import { guardOwnerRemoval } from './member-removal.ts'

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
 *   login-method rules like the rest of the dashboard: a refused session gets "not found", and
 *   one that signed in with a GitHub or Google the workspace switched off gets 403 with the
 *   reason (instance admins are never refused that way). Accepting an invitation counts too,
 *   so nobody joins a workspace through a method it does not allow.
 */
export function requestGuard(options: Pick<AuthOptions, 'db'>) {
  return createAuthMiddleware(async (ctx) => {
    await rememberOpenInvitations(options, ctx)
    await guardOwnerRemoval(options, ctx, async () => (await getSessionFromCtx(ctx))?.user.id)
    if (ctx.path === '/change-password') {
      const { currentPassword, newPassword } = ctx.body ?? {}
      if (typeof currentPassword === 'string' && currentPassword === newPassword) {
        throw new APIError('BAD_REQUEST', {
          message: 'The new password must be different from the current one.',
          code: 'PASSWORD_UNCHANGED',
        })
      }
      return
    }
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
    let ref = workspaceRef(ctx.body) ?? workspaceRef(ctx.query)
    if (!ref && ctx.path === '/organization/accept-invitation') {
      const invitationId: unknown = ctx.body?.invitationId
      if (typeof invitationId === 'string') {
        const [invitation] = await options.db
          .select({ workspaceId: schema.invitation.workspaceId })
          .from(schema.invitation)
          .where(eq(schema.invitation.id, invitationId))
        if (invitation) ref = { id: invitation.workspaceId }
      }
    }
    if (!ref) return
    const session = await getSessionFromCtx(ctx)
    if (!session) return
    const [workspace] = await options.db
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(ref.id ? eq(schema.workspace.id, ref.id) : eq(schema.workspace.slug, ref.slug ?? ''))
    if (!workspace) return
    const method = (await getSessionMethod(options.db, session.session.id)) ?? 'unknown'
    if (!(await isInstanceAdmin(options.db, session.user.id))) {
      const refusal = await providerRefusal(options.db, { workspaceId: workspace.id, method })
      if (refusal) throw new APIError('FORBIDDEN', { message: refusal })
    }
    if (!(await workspaceAcceptsSession(options.db, workspace.id, method))) {
      throw new APIError('NOT_FOUND', { message: 'Workspace not found' })
    }
  })
}
