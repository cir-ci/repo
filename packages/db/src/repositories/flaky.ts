import { and, count, desc, eq, gte, inArray } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { builds, projects, screenshotDiffs } from '../schema/index.ts'

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
  projectId: string,
  options: {
    /** Recent default-branch builds to look at. Default 10. */ window?: number
    /** Changed in at least this many. Default 3. */ minChanges?: number
  } = {},
): Promise<{ builds: number; flaky: FlakyScreenshot[] }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) return { builds: 0, flaky: [] }
  const recent = await db
    .select({ id: builds.id })
    .from(builds)
    .where(
      and(
        eq(builds.projectId, projectId),
        eq(builds.branch, project.defaultBranch),
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
