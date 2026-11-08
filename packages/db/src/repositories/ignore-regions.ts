import { ValidationError } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import { ignoreRegions, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { NotFoundError } from '#src/errors.ts'

/** Rectangles ignored when comparing a team's screenshots by name (PLAN M4). */

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export type IgnoreRegionRow = Region & {
  id: string
  name: string
  createdAt: Date
  /** Who added it; null for the CLI or when the person's account is gone. */
  createdBy: { id: string; name: string } | null
}

function assertRegion(r: Region): void {
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v) || v < 0)
      throw new ValidationError(`${k} must be a whole number, 0 or more`)
  }
  if (r.width < 1 || r.height < 1) throw new ValidationError('width and height must be at least 1')
  if (r.width > 20_000 || r.height > 20_000)
    throw new ValidationError('That region is larger than any screenshot')
}

export async function addIgnoreRegion(
  db: Database,
  teamId: string,
  input: Region & { name: string; createdBy?: string | null },
): Promise<IgnoreRegionRow> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('A screenshot name is required')
  assertRegion({ x: input.x, y: input.y, width: input.width, height: input.height })
  const [row] = await db
    .insert(ignoreRegions)
    .values({
      teamId,
      name,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: ignoreRegions.id })
  if (!row) throw new Error('insert returned no row')
  return getRegion(db, teamId, row.id)
}

const columns = {
  id: ignoreRegions.id,
  name: ignoreRegions.name,
  x: ignoreRegions.x,
  y: ignoreRegions.y,
  width: ignoreRegions.width,
  height: ignoreRegions.height,
  createdAt: ignoreRegions.createdAt,
  creatorId: user.id,
  creatorName: user.name,
}

function present(r: {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  createdAt: Date
  creatorId: string | null
  creatorName: string | null
}): IgnoreRegionRow {
  return {
    id: r.id,
    name: r.name,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    createdAt: r.createdAt,
    createdBy: r.creatorId && r.creatorName ? { id: r.creatorId, name: r.creatorName } : null,
  }
}

async function getRegion(db: Database, teamId: string, id: string): Promise<IgnoreRegionRow> {
  const [row] = await db
    .select(columns)
    .from(ignoreRegions)
    .leftJoin(user, eq(user.id, ignoreRegions.createdBy))
    .where(and(eq(ignoreRegions.teamId, teamId), eq(ignoreRegions.id, id)))
  if (!row) throw new NotFoundError('Ignore region not found')
  return present(row)
}

export async function listIgnoreRegions(db: Database, teamId: string): Promise<IgnoreRegionRow[]> {
  const rows = await db
    .select(columns)
    .from(ignoreRegions)
    .leftJoin(user, eq(user.id, ignoreRegions.createdBy))
    .where(eq(ignoreRegions.teamId, teamId))
    .orderBy(asc(ignoreRegions.name), asc(ignoreRegions.createdAt), asc(ignoreRegions.id))
  return rows.map(present)
}

/** Moves or resizes a region, or points it at another screenshot name (`NotFoundError` when the team has no such region). */
export async function changeIgnoreRegion(
  db: Database,
  teamId: string,
  id: string,
  patch: Partial<Region> & { name?: string },
): Promise<IgnoreRegionRow> {
  const current = await getRegion(db, teamId, id)
  const next = {
    name: patch.name === undefined ? current.name : patch.name.trim(),
    x: patch.x ?? current.x,
    y: patch.y ?? current.y,
    width: patch.width ?? current.width,
    height: patch.height ?? current.height,
  }
  if (!next.name) throw new ValidationError('A screenshot name is required')
  assertRegion({ x: next.x, y: next.y, width: next.width, height: next.height })
  await db
    .update(ignoreRegions)
    .set(next)
    .where(and(eq(ignoreRegions.teamId, teamId), eq(ignoreRegions.id, id)))
  return getRegion(db, teamId, id)
}

export async function removeIgnoreRegion(db: Database, teamId: string, id: string): Promise<void> {
  const rows = await db
    .delete(ignoreRegions)
    .where(and(eq(ignoreRegions.teamId, teamId), eq(ignoreRegions.id, id)))
    .returning({ id: ignoreRegions.id })
  if (rows.length === 0) throw new NotFoundError('Ignore region not found')
}

/** The regions of a team grouped by screenshot name, for the worker. */
export async function ignoreRegionsByName(
  db: Database,
  teamId: string,
): Promise<Map<string, Region[]>> {
  const map = new Map<string, Region[]>()
  for (const r of await listIgnoreRegions(db, teamId)) {
    const list = map.get(r.name) ?? []
    list.push({ x: r.x, y: r.y, width: r.width, height: r.height })
    map.set(r.name, list)
  }
  return map
}
