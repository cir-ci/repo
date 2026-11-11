import { ValidationError, assertFound } from '@circi/core'
import { and, eq } from 'drizzle-orm'

import {
  getIgnoreRegion,
  listIgnoreRegions,
  type IgnoreRegionRow,
  type Region,
} from '#queries/ignore-region-list.ts'
import { ignoreRegions } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Rectangles ignored when comparing a project's screenshots by name (PLAN M4). */

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
  input: Region & { name: string; createdBy?: string | null },
): Promise<IgnoreRegionRow> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('A screenshot name is required')
  assertRegion({ x: input.x, y: input.y, width: input.width, height: input.height })
  const [row] = await db
    .insert(ignoreRegions)
    .values({
      projectId,
      name,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: ignoreRegions.id })
  if (!row) throw new Error('insert returned no row')
  return getIgnoreRegion(db, projectId, row.id)
}

/** Moves or resizes a region, or points it at another screenshot name (`NotFoundError` when the project has no such region). */
export async function changeIgnoreRegion(
  db: Database,
  projectId: string,
  id: string,
  patch: Partial<Region> & { name?: string },
): Promise<IgnoreRegionRow> {
  const current = await getIgnoreRegion(db, projectId, id)
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
    .where(and(eq(ignoreRegions.projectId, projectId), eq(ignoreRegions.id, id)))
  return getIgnoreRegion(db, projectId, id)
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
  assertFound(rows[0], 'Ignore region not found')
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
