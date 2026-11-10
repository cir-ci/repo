import { onlyFlakyChanges, type FlakyChange, type FlakyDecision } from '@circi/core'
import { eq } from 'drizzle-orm'

import { flakyVerdictsFor } from '#queries/flaky.ts'
import { screenshotDiffs, screenshots, teams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Flaky screenshots and the merge gate (PLAN M4). The rule is `flakyScreenshots` in
 * `@circi/core`; this decides what a pull request's change is worth against it.
 */

/**
 * The gate's decision for a build: the team's flaky set as of the builds before this one (so the
 * build's own changes, or anything that came after it, never count), and whether every change in
 * the build is a flaky screenshot that looks like its known variation (`onlyFlakyChanges`).
 * Read only; `setBuildResult` stores it on the build when it finishes.
 */
export async function buildFlakyDecision(
  db: Database,
  build: { id: string; teamId: string; number: number },
): Promise<FlakyDecision> {
  const diffs = await db
    .select({
      name: screenshotDiffs.name,
      status: screenshotDiffs.status,
      score: screenshotDiffs.score,
      sizeChanged: screenshotDiffs.sizeChanged,
      fileSha256: screenshots.fileSha256,
    })
    .from(screenshotDiffs)
    .leftJoin(screenshots, eq(screenshots.id, screenshotDiffs.headScreenshotId))
    .where(eq(screenshotDiffs.buildId, build.id))
  const counts = { added: 0, removed: 0, changed: 0, failed: 0 }
  const changes: FlakyChange[] = []
  for (const d of diffs) {
    if (d.status === 'added' || d.status === 'removed' || d.status === 'failed') {
      counts[d.status] += 1
    } else if (d.status === 'changed') {
      counts.changed += 1
      changes.push({
        name: d.name,
        fileSha256: d.fileSha256,
        score: d.score,
        sizeChanged: d.sizeChanged,
      })
    }
  }
  const [team] = await db.select().from(teams).where(eq(teams.id, build.teamId))
  if (!team) return { flakyOnly: false, flaky: [] }
  const found = await flakyVerdictsFor(db, [team], { beforeNumber: build.number })
  const flaky = (found.get(team.id)?.flaky ?? []).map((f) => ({
    name: f.name,
    reason: f.reason,
    knownImages: f.knownImages,
    largestScore: f.largestScore,
  }))
  return { flakyOnly: onlyFlakyChanges({ counts, changes, flaky }), flaky }
}
