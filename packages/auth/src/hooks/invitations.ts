import * as schema from '@circi/db/schema'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { and, eq, gt, sql } from 'drizzle-orm'

import type { AuthOptions } from '#src/options.ts'

/** The invitation to an address that was still open when someone invited it again. */
interface Earlier {
  id: string
  role: string
}

const earlierByRequest = new WeakMap<object, Earlier[]>()

const INVITE = '/organization/invite-member'

/** The object that identifies one request in both the before and the after hook. */
const requestKey = (ctx: { request?: Request | undefined }): object | undefined => ctx.request

/**
 * Called before better-auth handles `invite-member`: remembers the invitations to this address
 * that are still open, because better-auth cancels them when the address is invited again (one
 * open invitation per address), and the answer should say so.
 */
export async function rememberOpenInvitations(
  options: Pick<AuthOptions, 'db'>,
  ctx: {
    path: string
    request?: Request | undefined
    body?: { email?: unknown; organizationId?: unknown } | undefined
  },
): Promise<void> {
  if (ctx.path !== INVITE) return
  const key = requestKey(ctx)
  const email = ctx.body?.email
  const workspaceId = ctx.body?.organizationId
  if (!key || typeof email !== 'string' || typeof workspaceId !== 'string') return
  const open = await options.db
    .select({ id: schema.invitation.id, role: schema.invitation.role })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.workspaceId, workspaceId),
        sql`lower(${schema.invitation.email}) = ${email.trim().toLowerCase()}`,
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
  if (open.length > 0)
    earlierByRequest.set(
      key,
      open.map((i) => ({ id: i.id, role: i.role ?? '' })),
    )
}

/**
 * Runs after the organization endpoints (CirCI's workspaces).
 *
 * - After `invite-member`: when the new invitation replaced an open one to the same address
 *   (not the same invitation sent again with `resend`), the answer carries `replaced: true` and
 *   the role the earlier one offered, so the page can tell the inviter that the first link no
 *   longer works.
 * - A signed-in person who may not do something (a plain member removing someone, say) is
 *   "forbidden", not "unauthorized": they are known, they just may not. better-auth answers 401
 *   for those; 401 stays for a missing session.
 */
export function afterOrganizationRequest() {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.path.startsWith('/organization/')) return undefined
    const returned: unknown = ctx.context.returned
    if (returned instanceof APIError) {
      if (returned.statusCode !== 401 || !(await getSessionFromCtx(ctx))) return undefined
      // The status of a thrown error would not replace the endpoint's own 401, so answer directly.
      return new Response(
        JSON.stringify({ message: returned.message, code: returned.body?.code ?? 'FORBIDDEN' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    }
    if (ctx.path !== INVITE) return undefined
    const key = requestKey(ctx)
    const earlier = key ? earlierByRequest.get(key) : undefined
    if (key) earlierByRequest.delete(key)
    if (!earlier?.length || typeof returned !== 'object' || returned === null) return undefined
    const id: unknown = Reflect.get(returned, 'id')
    if (typeof id !== 'string' || earlier.some((e) => e.id === id)) return undefined
    return ctx.json({ ...returned, replaced: true, replacedRole: earlier[0]?.role ?? null })
  })
}
