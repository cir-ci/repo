import { and, eq, inArray, sql } from 'drizzle-orm'

import { findTriageProblems } from '#queries/triage.ts'
import { flakyAnnounced, projects, triageProblems } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

const id = (p: { kind: string; key: string }) => `${p.kind}\u0000${p.key}`

/** Rows per INSERT: three bind parameters each, well under Postgres's limit of 65535. */
const CHUNK = 5000

/**
 * Brings a project's `triage_problems` rows in line with its builds: the queue's derived part
 * (flaky screenshots, screenshots with no baseline, failed builds; `findTriageProblems`) stored so
 * the sidebar can count it with an index. Call it, in the writer's own transaction, after anything
 * that can change the queue: a default-branch build completing, failing, being re-run or expiring,
 * a review on one, or the project's default branch or flaky threshold changing. It changes only
 * the rows that differ (and, with `branch`, does nothing for a branch that isn't the default),
 * and runs one project at a time (an advisory lock held to the end of the
 * transaction), so two writers can't leave an older answer behind a newer one.
 *
 * Returns the names of the screenshots that entered the flaky list in this call and were never
 * announced for this project before, decided under that lock (`flaky_announced` remembers each
 * name for good, so one that leaves the history window and returns is not told again, and two
 * builds finishing together report it once). With `announce: false` (the default branch changed:
 * the new branch's whole flaky set is not news) the names are remembered and none is returned.
 * Data only: telling people is the calling service's job (`notifyFlakyDetected`).
 */
export async function refreshTriageProblems(
  db: Database,
  projectId: string,
  options: { branch?: string | null; announce?: boolean } = {},
): Promise<string[]> {
  return db.transaction(async (tx) => {
    // A build on another branch can't change the queue.
    if (options.branch !== undefined) {
      const [row] = await tx
        .select({ defaultBranch: projects.defaultBranch })
        .from(projects)
        .where(eq(projects.id, projectId))
      if (row?.defaultBranch !== options.branch) return []
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`triage:${projectId}`}, 0))`,
    )
    const [project] = await tx
      .select({
        id: projects.id,
        defaultBranch: projects.defaultBranch,
        flakyAfterChanges: projects.flakyAfterChanges,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
    if (!project) return []
    const wanted = await findTriageProblems(tx, project)
    const stored = await tx
      .select({ kind: triageProblems.kind, key: triageProblems.key })
      .from(triageProblems)
      .where(eq(triageProblems.projectId, projectId))
    const have = new Set(stored.map(id))
    const want = new Set(wanted.map(id))
    const toAdd = wanted.filter((p) => !have.has(id(p)))
    const toRemove = stored.filter((p) => !want.has(id(p)))
    for (const kind of ['flaky', 'no_baseline', 'failed'] as const) {
      const keys = toRemove.filter((p) => p.kind === kind).map((p) => p.key)
      for (let i = 0; i < keys.length; i += CHUNK) {
        // oxlint-disable-next-line no-await-in-loop -- one transaction, one connection
        await tx
          .delete(triageProblems)
          .where(
            and(
              eq(triageProblems.projectId, projectId),
              eq(triageProblems.kind, kind),
              inArray(triageProblems.key, keys.slice(i, i + CHUNK)),
            ),
          )
      }
    }
    for (let i = 0; i < toAdd.length; i += CHUNK) {
      // oxlint-disable-next-line no-await-in-loop -- one transaction, one connection
      await tx
        .insert(triageProblems)
        .values(toAdd.slice(i, i + CHUNK).map((p) => ({ projectId, kind: p.kind, key: p.key })))
        .onConflictDoNothing()
    }
    // Flaky names stay flagged as seen; only the ones never seen before are news.
    const flakyKeys = toAdd.filter((p) => p.kind === 'flaky').map((p) => p.key)
    const fresh: string[] = []
    for (let i = 0; i < flakyKeys.length; i += CHUNK) {
      // oxlint-disable-next-line no-await-in-loop -- one transaction, one connection
      const rows = await tx
        .insert(flakyAnnounced)
        .values(flakyKeys.slice(i, i + CHUNK).map((key) => ({ projectId, key })))
        .onConflictDoNothing()
        .returning({ key: flakyAnnounced.key })
      fresh.push(...rows.map((r) => r.key))
    }
    return options.announce === false ? [] : fresh
  })
}
