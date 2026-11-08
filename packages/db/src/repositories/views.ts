import { type BuildFilterValues, ValidationError } from '@circi/core'
import { and, asc, eq, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '../errors.ts'
import { projects, savedViews, userPinnedProjects } from '../schema/index.ts'

/**
 * Saved views and pinned projects: a person's own sidebar. Every function takes the owner and
 * only ever touches that person's rows, so someone else's view is "not found". The caller has
 * already checked that the person belongs to the organization.
 */

export interface SavedViewRow {
  id: string
  name: string
  filters: BuildFilterValues
  pinned: boolean
  position: number
  /** Null for a view across the whole organization. */
  project: { slug: string; name: string } | null
  createdAt: Date
}

const MAX_NAME = 80
const MAX_VIEWS = 100

function checkName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ValidationError('A view needs a name')
  if (trimmed.length > MAX_NAME) throw new ValidationError('That name is too long')
  return trimmed
}

const viewColumns = {
  id: savedViews.id,
  name: savedViews.name,
  filters: savedViews.filters,
  pinned: savedViews.pinned,
  position: savedViews.position,
  createdAt: savedViews.createdAt,
  project: { slug: projects.slug, name: projects.name },
}

/** A person's views in an organization, in their order. */
export async function listSavedViews(
  db: Database,
  input: { userId: string; orgId: string },
): Promise<SavedViewRow[]> {
  const rows = await db
    .select(viewColumns)
    .from(savedViews)
    .leftJoin(projects, eq(projects.id, savedViews.projectId))
    .where(and(eq(savedViews.userId, input.userId), eq(savedViews.orgId, input.orgId)))
    .orderBy(asc(savedViews.position), asc(savedViews.createdAt), asc(savedViews.id))
  return rows
}

async function getSavedView(
  db: Database,
  input: { userId: string; orgId: string; id: string },
): Promise<SavedViewRow> {
  const [row] = await db
    .select(viewColumns)
    .from(savedViews)
    .leftJoin(projects, eq(projects.id, savedViews.projectId))
    .where(
      and(
        eq(savedViews.id, input.id),
        eq(savedViews.userId, input.userId),
        eq(savedViews.orgId, input.orgId),
      ),
    )
  if (!row) throw new NotFoundError('View not found')
  return row
}

/** Adds a view after the person's others. A name already in use is a `ConflictError`. */
export async function createSavedView(
  db: Database,
  input: createSavedView.Input,
): Promise<SavedViewRow> {
  const name = checkName(input.name)
  if (input.projectId) {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.orgId, input.orgId)))
    if (!p) throw new ValidationError('That project is not in this organization')
  }
  const scope = and(eq(savedViews.userId, input.userId), eq(savedViews.orgId, input.orgId))
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
        orgId: input.orgId,
        projectId: input.projectId ?? null,
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
    orgId: string
    projectId?: string | null
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
            eq(savedViews.orgId, input.orgId),
          ),
        )
        .returning({ id: savedViews.id })
      if (rows.length === 0) throw new NotFoundError('View not found')
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
    orgId: string
    id: string
    name?: string
    filters?: BuildFilterValues
    pinned?: boolean
  }
}

/** Puts the person's views in the given order; `ids` must be exactly their views here. */
export async function reorderSavedViews(
  db: Database,
  input: { userId: string; orgId: string; ids: string[] },
): Promise<SavedViewRow[]> {
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(and(eq(savedViews.userId, input.userId), eq(savedViews.orgId, input.orgId)))
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
  input: { userId: string; orgId: string; id: string },
): Promise<void> {
  const rows = await db
    .delete(savedViews)
    .where(
      and(
        eq(savedViews.id, input.id),
        eq(savedViews.userId, input.userId),
        eq(savedViews.orgId, input.orgId),
      ),
    )
    .returning({ id: savedViews.id })
  if (rows.length === 0) throw new NotFoundError('View not found')
}

/** Pins a project after the person's other pins. Returns false when it was already pinned. */
export async function pinProject(
  db: Database,
  input: { userId: string; projectId: string },
): Promise<boolean> {
  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${userPinnedProjects.position}), -1)` })
    .from(userPinnedProjects)
    .where(eq(userPinnedProjects.userId, input.userId))
  const rows = await db
    .insert(userPinnedProjects)
    .values({ ...input, position: (last?.max ?? -1) + 1 })
    .onConflictDoNothing()
    .returning({ projectId: userPinnedProjects.projectId })
  return rows.length > 0
}

/** Unpins a project. Returns false when it was not pinned. */
export async function unpinProject(
  db: Database,
  input: { userId: string; projectId: string },
): Promise<boolean> {
  const rows = await db
    .delete(userPinnedProjects)
    .where(
      and(
        eq(userPinnedProjects.userId, input.userId),
        eq(userPinnedProjects.projectId, input.projectId),
      ),
    )
    .returning({ projectId: userPinnedProjects.projectId })
  return rows.length > 0
}

/** The ids of the projects a person pinned, in pin order. */
export async function listPinnedProjectIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userPinnedProjects.projectId })
    .from(userPinnedProjects)
    .where(eq(userPinnedProjects.userId, userId))
    .orderBy(asc(userPinnedProjects.position), asc(userPinnedProjects.createdAt))
  return rows.map((r) => r.id)
}
