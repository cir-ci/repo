import { onlyFlakyChanges } from '@circi/core'
import { and, count, desc, eq, gte, inArray } from 'drizzle-orm'

import { builds, teams, screenshotDiffs } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Flaky screenshots (PLAN M4): ones that keep showing up as changed on the default branch.
 * Nobody reviews those builds (they're approved automatically), so a screenshot that changes
 * again and again there is almost certainly nondeterministic, not a real change each time.
 */

export interface FlakyScreenshot {
  name: string
  /** In how many of the recent default-branch builds it showed as changed. */
  changedIn: number
}

export async function listFlakyScreenshots(
  db: Database,
  teamId: string,
  options: {
    /** Recent default-branch builds to look at. Default 10. */ window?: number
    /** Changed in at least this many. Default 3. */ minChanges?: number
  } = {},
): Promise<{ builds: number; flaky: FlakyScreenshot[] }> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
  if (!team) return { builds: 0, flaky: [] }
  const recent = await db
    .select({ id: builds.id })
    .from(builds)
    .where(
      and(
        eq(builds.teamId, teamId),
        eq(builds.branch, team.defaultBranch),
        eq(builds.status, 'complete'),
      ),
    )
    .orderBy(desc(builds.number))
    .limit(options.window ?? 10)
  if (recent.length === 0) return { builds: 0, flaky: [] }
  const rows = await db
    .select({ name: screenshotDiffs.name, changedIn: count() })
    .from(screenshotDiffs)
    .where(
      and(
        eq(screenshotDiffs.status, 'changed'),
        inArray(
          screenshotDiffs.buildId,
          recent.map((r) => r.id),
        ),
      ),
    )
    .groupBy(screenshotDiffs.name)
    .having(gte(count(), options.minChanges ?? 3))
    .orderBy(desc(count()), screenshotDiffs.name)
  return { builds: recent.length, flaky: rows }
}

/**
 * Whether the build's only differences are flaky screenshots (see `onlyFlakyChanges`): the
 * team's current flaky list against what this build changed.
 */
export async function buildChangesAreFlakyOnly(
  db: Database,
  build: { id: string; teamId: string },
): Promise<boolean> {
  const diffs = await db
    .select({ name: screenshotDiffs.name, status: screenshotDiffs.status })
    .from(screenshotDiffs)
    .where(eq(screenshotDiffs.buildId, build.id))
  const counts = { added: 0, removed: 0, changed: 0, failed: 0 }
  const changed: string[] = []
  for (const d of diffs) {
    if (d.status === 'added' || d.status === 'removed' || d.status === 'failed') {
      counts[d.status] += 1
    } else if (d.status === 'changed') {
      counts.changed += 1
      changed.push(d.name)
    }
  }
  // Skip the flaky query for the common case of a build that is plainly not flaky-only.
  if (counts.changed === 0 || counts.added + counts.removed + counts.failed > 0) return false
  const { flaky } = await listFlakyScreenshots(db, build.teamId)
  return onlyFlakyChanges({ counts, changed, flaky: flaky.map((f) => f.name) })
}
