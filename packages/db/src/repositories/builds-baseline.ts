import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'

import { type BaselineSource, builds, projects, snapshotReviews } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/** Which earlier build a build is compared with. */

/** A possible baseline, with the snapshots it has current decisions on. */
export type BaselineCandidate = Build & {
  approvedSnapshots: string[]
  rejectedSnapshots: string[]
}

/**
 * Possible baselines: same project and name, finished, not the build itself. Each carries the
 * names of its approved and rejected snapshots, so one approved snapshot of a build still
 * waiting on review can be a baseline (`resolveBaseline` in `@circi/core`).
 */
export async function listBaselineCandidates(
  db: Database,
  build: Pick<Build, 'projectId' | 'name' | 'ancestorShas'> & { id?: string },
): Promise<BaselineCandidate[]> {
  const conditions = [
    eq(builds.projectId, build.projectId),
    eq(builds.name, build.name),
    eq(builds.status, 'complete'),
    ...(build.id ? [ne(builds.id, build.id)] : []),
  ]
  const shas = [...new Set(build.ancestorShas)]
  const project = await db
    .select({ defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, build.projectId))
  const defaultBranch = project[0]?.defaultBranch ?? 'main'

  // Builds on ancestor commits, plus recent default-branch builds for the fallback.
  const byAncestry =
    shas.length > 0
      ? await db
          .select()
          .from(builds)
          .where(and(...conditions, inArray(builds.commitSha, shas)))
      : []
  const recentDefault = await db
    .select()
    .from(builds)
    .where(and(...conditions, eq(builds.branch, defaultBranch)))
    .orderBy(desc(builds.createdAt))
    .limit(50)
  const seen = new Map<string, Build>()
  for (const b of [...byAncestry, ...recentDefault]) seen.set(b.id, b)
  const candidates = [...seen.values()]
  const decisions =
    candidates.length === 0
      ? []
      : await db
          .select({
            buildId: snapshotReviews.buildId,
            name: snapshotReviews.snapshotName,
            decision: snapshotReviews.decision,
          })
          .from(snapshotReviews)
          .where(
            and(
              inArray(
                snapshotReviews.buildId,
                candidates.map((c) => c.id),
              ),
              isNull(snapshotReviews.supersededAt),
            ),
          )
  return candidates.map((c) =>
    Object.assign(c, {
      approvedSnapshots: decisions
        .filter((d) => d.buildId === c.id && d.decision === 'approved')
        .map((d) => d.name),
      rejectedSnapshots: decisions
        .filter((d) => d.buildId === c.id && d.decision === 'rejected')
        .map((d) => d.name),
    }),
  )
}

export async function setBuildBaseline(
  db: Database,
  buildId: string,
  baseline: {
    baseBuildId: string | null
    baselineSource: BaselineSource
  },
): Promise<void> {
  await db.update(builds).set(baseline).where(eq(builds.id, buildId))
}
