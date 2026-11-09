import { and, asc, eq } from 'drizzle-orm'

import { ignoreRegions, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { assertFound } from '#src/errors.ts'

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

export function present(r: {
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

/** One of the team's regions; `NotFoundError` when it has no such region. */
export async function getIgnoreRegion(
  db: Database,
  teamId: string,
  id: string,
): Promise<IgnoreRegionRow> {
  const [row] = await db
    .select(columns)
    .from(ignoreRegions)
    .leftJoin(user, eq(user.id, ignoreRegions.createdBy))
    .where(and(eq(ignoreRegions.teamId, teamId), eq(ignoreRegions.id, id)))
  assertFound(row, 'Ignore region not found')
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
