import type { BuildOrder } from '@circi/core'
import { aliasedTable, asc, desc, type SQL, sql } from 'drizzle-orm'

import { builds, screenshotDiffs } from '#schema/index.ts'

/**
 * Ordering and keyset paging of the builds lists. Each order is a key tuple over a build (its
 * "tie" columns last, so the key is unique), read in one direction:
 *
 * - `newest`: tie, descending; `oldest`: tie, ascending;
 * - `most-changes`: (changed screenshots, tie), descending;
 * - `status`: (minus the status rank, tie), descending, so builds that need attention come first.
 *
 * A page starts after a cursor build: its key is read from the database in the same comparison, so
 * no value is round-tripped (a JS Date would cut timestamps to milliseconds and repeat or skip
 * builds that share one).
 */

export type { BuildOrder }

type BuildRow = typeof builds

/** How a list identifies a build uniquely, and what its cursor names. */
export interface BuildTie {
  /** The unique columns, most significant first (a project: `number`; a workspace: `created_at, id`). */
  columns(t: BuildRow): SQL[]
}

export const projectTie: BuildTie = { columns: (t) => [sql`${t.number}`] }
export const workspaceTie: BuildTie = { columns: (t) => [sql`${t.createdAt}`, sql`${t.id}`] }

/** Screenshots that differ from their baseline: added, removed or changed. */
const changes = (t: BuildRow): SQL =>
  sql`(select count(*)::int from ${screenshotDiffs} d where d.build_id = ${t.id} and d.status in ('added', 'removed', 'changed'))`

/**
 * Where a build sorts under `status`, smallest first: still being made, failed, waiting for a
 * review, rejected, approved, anything else, expired. Read from the stored columns only.
 */
const statusRank = (t: BuildRow): SQL => sql`(case
  when ${t.status} in ('pending', 'uploading', 'processing') then 0
  when ${t.status} = 'error' then 1
  when ${t.status} = 'expired' then 6
  when ${t.conclusion} = 'changes_detected' and ${t.reviewStatus} = 'pending' then 2
  when ${t.reviewStatus} = 'rejected' then 3
  when ${t.reviewStatus} = 'approved' then 4
  else 5 end)`

function key(order: BuildOrder, tie: BuildTie, t: BuildRow): SQL[] {
  if (order === 'most-changes') return [changes(t), ...tie.columns(t)]
  if (order === 'status') return [sql`(-${statusRank(t)})`, ...tie.columns(t)]
  return tie.columns(t)
}

/** `order by` for the order. */
export function buildOrderBy(order: BuildOrder, tie: BuildTie): SQL[] {
  const direction = order === 'oldest' ? asc : desc
  return key(order, tie, builds).map((k) => direction(k))
}

/**
 * The condition that keeps the builds after the cursor build in this order. `cursorMatch` picks
 * the cursor row (aliased `c`) in the same table. A cursor that names no build matches nothing.
 */
export function buildAfterCursor(
  order: BuildOrder,
  tie: BuildTie,
  cursorMatch: (c: BuildRow) => SQL,
): SQL {
  const c = aliasedTable(builds, 'c')
  const mine = sql.join(key(order, tie, builds), sql`, `)
  const theirs = sql.join(key(order, tie, c), sql`, `)
  const op = order === 'oldest' ? sql`>` : sql`<`
  return sql`(${mine}) ${op} (select ${theirs} from ${builds} ${sql.identifier('c')} where ${cursorMatch(c)})`
}
