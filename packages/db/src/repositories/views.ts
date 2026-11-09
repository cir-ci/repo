import { type BuildFilterValues, ValidationError, assertFound } from '@circi/core'
import { and, eq, sql } from 'drizzle-orm'

import { type SavedViewRow, viewColumns, listSavedViews } from '#queries/saved-views.ts'
import { teams, savedViews, userPinnedTeams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'

/**
 * Saved views and pinned teams: a person's own sidebar. Every function takes the owner and
 * only ever touches that person's rows, so someone else's view is "not found". The caller has
 * already checked that the person belongs to the workspace.
 */

const MAX_NAME = 80
const MAX_VIEWS = 100

function checkName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ValidationError('A view needs a name')
  if (trimmed.length > MAX_NAME) throw new ValidationError('That name is too long')
  return trimmed
}

async function getSavedView(
  db: Database,
  input: { userId: string; workspaceId: string; id: string },
): Promise<SavedViewRow> {
  const [row] = await db
    .select(viewColumns)
    .from(savedViews)
    .leftJoin(teams, eq(teams.id, savedViews.teamId))
    .where(
      and(
        eq(savedViews.id, input.id),
        eq(savedViews.userId, input.userId),
        eq(savedViews.workspaceId, input.workspaceId),
      ),
    )
  assertFound(row, 'View not found')
  return row
}

/** Adds a view after the person's others. A name already in use is a `ConflictError`. */
export async function createSavedView(
  db: Database,
  input: createSavedView.Input,
): Promise<SavedViewRow> {
  const name = checkName(input.name)
  if (input.teamId) {
    const [p] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, input.teamId), eq(teams.workspaceId, input.workspaceId)))
    if (!p) throw new ValidationError('That team is not in this workspace')
  }
  const scope = and(
    eq(savedViews.userId, input.userId),
    eq(savedViews.workspaceId, input.workspaceId),
  )
  const [stats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      max: sql<number>`coalesce(max(${savedViews.position}), -1)`,
    })
    .from(savedViews)
    .where(scope)
  if ((stats?.count ?? 0) >= MAX_VIEWS) throw new ValidationError('That is too many views')
  try {
    const [row] = await db
      .insert(savedViews)
      .values({
        userId: input.userId,
        workspaceId: input.workspaceId,
        teamId: input.teamId ?? null,
        name,
        filters: input.filters,
        pinned: input.pinned ?? false,
        position: (stats?.max ?? -1) + 1,
      })
      .returning({ id: savedViews.id })
    if (!row) throw new Error('insert returned no row')
    return await getSavedView(db, { ...input, id: row.id })
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('You already have a view with that name')
    throw err
  }
}
export namespace createSavedView {
  export interface Input {
    userId: string
    workspaceId: string
    teamId?: string | null
    name: string
    filters: BuildFilterValues
    pinned?: boolean
  }
}

/** Changes a view's name, filters or pinned flag; returns the view as it is now. */
export async function updateSavedView(
  db: Database,
  input: updateSavedView.Input,
): Promise<SavedViewRow> {
  const set: Partial<typeof savedViews.$inferInsert> = {}
  if (input.name !== undefined) set.name = checkName(input.name)
  if (input.filters !== undefined) set.filters = input.filters
  if (input.pinned !== undefined) set.pinned = input.pinned
  if (Object.keys(set).length > 0) {
    try {
      const rows = await db
        .update(savedViews)
        .set(set)
        .where(
          and(
            eq(savedViews.id, input.id),
            eq(savedViews.userId, input.userId),
            eq(savedViews.workspaceId, input.workspaceId),
          ),
        )
        .returning({ id: savedViews.id })
      assertFound(rows[0], 'View not found')
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('You already have a view with that name')
      throw err
    }
  }
  return getSavedView(db, input)
}
export namespace updateSavedView {
  export interface Input {
    userId: string
    workspaceId: string
    id: string
    name?: string
    filters?: BuildFilterValues
    pinned?: boolean
  }
}

/** Puts the person's views in the given order; `ids` must be exactly their views here. */
export async function reorderSavedViews(
  db: Database,
  input: { userId: string; workspaceId: string; ids: string[] },
): Promise<SavedViewRow[]> {
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(
        and(eq(savedViews.userId, input.userId), eq(savedViews.workspaceId, input.workspaceId)),
      )
    const ids = new Set(input.ids)
    if (
      ids.size !== input.ids.length ||
      ids.size !== current.length ||
      !current.every((c) => ids.has(c.id))
    ) {
      throw new ValidationError('List every one of your views exactly once')
    }
    await Promise.all(
      input.ids.map((id, position) =>
        tx.update(savedViews).set({ position }).where(eq(savedViews.id, id)),
      ),
    )
  })
  return listSavedViews(db, input)
}

export async function deleteSavedView(
  db: Database,
  input: { userId: string; workspaceId: string; id: string },
): Promise<void> {
  const rows = await db
    .delete(savedViews)
    .where(
      and(
        eq(savedViews.id, input.id),
        eq(savedViews.userId, input.userId),
        eq(savedViews.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: savedViews.id })
  assertFound(rows[0], 'View not found')
}

/** Pins a team after the person's other pins. Returns false when it was already pinned. */
export async function pinTeam(
  db: Database,
  input: { userId: string; teamId: string },
): Promise<boolean> {
  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${userPinnedTeams.position}), -1)` })
    .from(userPinnedTeams)
    .where(eq(userPinnedTeams.userId, input.userId))
  const rows = await db
    .insert(userPinnedTeams)
    .values({ ...input, position: (last?.max ?? -1) + 1 })
    .onConflictDoNothing()
    .returning({ teamId: userPinnedTeams.teamId })
  return rows.length > 0
}

/** Unpins a team. Returns false when it was not pinned. */
export async function unpinTeam(
  db: Database,
  input: { userId: string; teamId: string },
): Promise<boolean> {
  const rows = await db
    .delete(userPinnedTeams)
    .where(and(eq(userPinnedTeams.userId, input.userId), eq(userPinnedTeams.teamId, input.teamId)))
    .returning({ teamId: userPinnedTeams.teamId })
  return rows.length > 0
}
