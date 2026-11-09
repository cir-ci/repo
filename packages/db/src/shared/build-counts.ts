import { eq, sql } from 'drizzle-orm'

import { screenshotDiffs } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

export async function getBuildCounts(
  db: Database,
  buildId: string,
): Promise<getBuildCounts.Counts> {
  const rows = await db
    .select({ status: screenshotDiffs.status, n: sql<number>`count(*)::int` })
    .from(screenshotDiffs)
    .where(eq(screenshotDiffs.buildId, buildId))
    .groupBy(screenshotDiffs.status)
  const counts: getBuildCounts.Counts = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
    failed: 0,
    total: 0,
  }
  for (const r of rows) {
    if (r.status && r.status in counts) counts[r.status] += r.n
    counts.total += r.n
  }
  return counts
}

export namespace getBuildCounts {
  export interface Counts {
    added: number
    removed: number
    changed: number
    unchanged: number
    failed: number
    total: number
  }
}
