import { ValidationError } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { NotFoundError } from '../errors.ts'
import { ignoreRegions } from '../schema/index.ts'

/** Rectangles ignored when comparing a project's screenshots by name (PLAN M4). */

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export type IgnoreRegionRow = Region & { id: string; name: string }

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
  projectId: string,
  input: Region & { name: string },
): Promise<IgnoreRegionRow> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('A screenshot name is required')
  assertRegion({ x: input.x, y: input.y, width: input.width, height: input.height })
  const [row] = await db
    .insert(ignoreRegions)
    .values({ projectId, name, x: input.x, y: input.y, width: input.width, height: input.height })
    .returning()
  if (!row) throw new Error('insert returned no row')
  return { id: row.id, name: row.name, x: row.x, y: row.y, width: row.width, height: row.height }
}

export async function listIgnoreRegions(
  db: Database,
  projectId: string,
): Promise<IgnoreRegionRow[]> {
  const rows = await db
    .select()
    .from(ignoreRegions)
    .where(eq(ignoreRegions.projectId, projectId))
    .orderBy(asc(ignoreRegions.name), asc(ignoreRegions.createdAt))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  }))
}

export async function removeIgnoreRegion(
  db: Database,
  projectId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(ignoreRegions)
    .where(and(eq(ignoreRegions.projectId, projectId), eq(ignoreRegions.id, id)))
    .returning({ id: ignoreRegions.id })
  if (rows.length === 0) throw new NotFoundError('Ignore region not found')
}

/** The regions of a project grouped by screenshot name, for the worker. */
export async function ignoreRegionsByName(
  db: Database,
  projectId: string,
): Promise<Map<string, Region[]>> {
  const map = new Map<string, Region[]>()
  for (const r of await listIgnoreRegions(db, projectId)) {
    const list = map.get(r.name) ?? []
    list.push({ x: r.x, y: r.y, width: r.width, height: r.height })
    map.set(r.name, list)
  }
  return map
}
