import { and, count, desc, eq, gte, inArray } from 'drizzle-orm'

import { builds, screenshotDiffs, teams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** The team's flaky screenshots (see `repositories/flaky.ts` for what flaky means). */

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
    /** Changed in at least this many. Default: the team's `flakyAfterChanges`. */ minChanges?: number
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
    .having(gte(count(), options.minChanges ?? team.flakyAfterChanges))
    .orderBy(desc(count()), screenshotDiffs.name)
  return { builds: recent.length, flaky: rows }
}
