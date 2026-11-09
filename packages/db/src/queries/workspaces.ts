import { and, asc, eq, inArray } from 'drizzle-orm'

import { member, workspace } from '#schema/index.ts'
import { workspaceAccepts, workspaceIsLive, type SessionMethod } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'
import { NotFoundError } from '#src/errors.ts'
import type { Workspace } from '#src/types.ts'

/**
 * Read access to workspaces and memberships. They're owned by better-auth's organization
 * plugin: create workspaces and add members through `@circi/auth`, never by writing these tables.
 */

export async function listWorkspaces(db: Database): Promise<Workspace[]> {
  return db.select().from(workspace).orderBy(asc(workspace.slug))
}

/** The workspace with this slug, or undefined. */
export async function findWorkspaceBySlug(
  db: Database,
  slug: string,
): Promise<Workspace | undefined> {
  const [found] = await db.select().from(workspace).where(eq(workspace.slug, slug))
  return found
}

export async function getWorkspaceBySlug(db: Database, slug: string): Promise<Workspace> {
  const found = await findWorkspaceBySlug(db, slug)
  if (!found) throw new NotFoundError(`Workspace "${slug}" not found`)
  return found
}

/** The workspaces a user belongs to: the boundary of everything they may see (PLAN §8). */
export async function listUserWorkspaceIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: member.workspaceId })
    .from(member)
    .where(and(eq(member.userId, userId), workspaceIsLive(member.workspaceId)))
  return rows.map((r) => r.id)
}

/**
 * A user who owns the workspace. better-auth only lets owners issue workspace-owned API
 * keys, so CI tokens are issued on behalf of one.
 */
export async function findWorkspaceOwnerId(
  db: Database,
  workspaceId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.role, 'owner')))
    .limit(1)
  return row?.userId
}

/** The user's role in a workspace, or undefined when they aren't a member. */
export async function getMemberRole(
  db: Database,
  input: { userId: string; workspaceId: string },
): Promise<string | undefined> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, input.userId), eq(member.workspaceId, input.workspaceId)))
  return row?.role
}

/** Workspaces where the user is an owner or admin, i.e. may create teams. */
export async function listManageableWorkspaces(
  db: Database,
  userId: string,
  method?: SessionMethod,
): Promise<{ slug: string; name: string }[]> {
  return db
    .select({ slug: workspace.slug, name: workspace.name })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(
      and(
        eq(member.userId, userId),
        inArray(member.role, ['owner', 'admin']),
        workspaceAccepts(workspace.id, method),
      ),
    )
    .orderBy(asc(workspace.slug))
}
