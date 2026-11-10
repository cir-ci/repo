import * as schema from '@circi/db/schema'
import { APIError } from 'better-auth/api'
import { and, eq, or, sql } from 'drizzle-orm'

import type { AuthOptions } from '#src/options.ts'

const REMOVE = '/organization/remove-member'

/**
 * Called before better-auth handles `remove-member`: an admin may not remove an owner. Without
 * this, better-auth answers a 400 about "the only owner" (or a bare refusal), which says nothing
 * about who may do it. A request that names no workspace or member is left to better-auth.
 */
export async function guardOwnerRemoval(
  options: Pick<AuthOptions, 'db'>,
  ctx: {
    path: string
    body?: { memberIdOrEmail?: unknown; organizationId?: unknown } | undefined
  },
  /** Who is asking (looked up only when the request is a removal). */
  currentUserId: () => Promise<string | undefined>,
): Promise<void> {
  if (ctx.path !== REMOVE) return
  const target = ctx.body?.memberIdOrEmail
  const workspaceId = ctx.body?.organizationId
  if (typeof target !== 'string' || typeof workspaceId !== 'string') return
  const userId = await currentUserId()
  if (!userId) return
  const [seat] = await options.db
    .select({ role: schema.member.role })
    .from(schema.member)
    .leftJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      and(
        eq(schema.member.workspaceId, workspaceId),
        or(
          eq(schema.member.id, target),
          sql`lower(${schema.user.email}) = ${target.trim().toLowerCase()}`,
        ),
      ),
    )
  if (!seat?.role.split(',').includes('owner')) return
  const [mine] = await options.db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.workspaceId, workspaceId), eq(schema.member.userId, userId)))
  // Not a member at all: better-auth's own refusal stands.
  if (!mine || mine.role.split(',').includes('owner')) return
  throw new APIError('FORBIDDEN', { message: 'Only owners can remove an owner.' })
}
