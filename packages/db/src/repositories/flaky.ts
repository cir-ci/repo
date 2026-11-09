import { onlyFlakyChanges } from '@circi/core'
import { eq } from 'drizzle-orm'

import { screenshotDiffs } from '#schema/index.ts'
import { listFlakyScreenshots } from '#shared/flaky.ts'
import type { Database } from '#src/client.ts'
export * from '#shared/flaky.ts'

/**
 * Flaky screenshots (PLAN M4): ones that keep showing up as changed on the default branch.
 * Nobody reviews those builds (they're approved automatically), so a screenshot that changes
 * again and again there is almost certainly nondeterministic, not a real change each time.
 */

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
