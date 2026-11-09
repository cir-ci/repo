import { type Build, type Database } from '@circi/db'
import { createBuild } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { eq } from 'drizzle-orm'

import { nextCreatedAt } from '../created-at.ts'

let n = 0

export namespace seedBuild {
  export interface Input extends Omit<createBuild.Input, 'teamId' | 'commitSha'> {
    commitSha?: string
    /** Set after creation, for builds that should already be past `uploading`. */
    status?: Build['status']
    conclusion?: Build['conclusion']
    reviewStatus?: Build['reviewStatus']
    completedAt?: Date
    createdAt?: Date
    /**
     * Names of changed snapshots (diff rows) a build gets, so it has something
     * to review. Default none.
     */
    changedSnapshots?: readonly string[]
  }
}

/** A build in `teamId`, created through `createBuild` (so numbering and counters are real). */
export async function seedBuild(
  db: Database,
  teamId: string,
  input: seedBuild.Input = {},
): Promise<Build> {
  n += 1
  const {
    status,
    conclusion,
    reviewStatus,
    completedAt,
    createdAt,
    commitSha,
    changedSnapshots,
    ...rest
  } = input
  const build = await createBuild(db, {
    ...rest,
    teamId,
    commitSha: commitSha ?? `abc${String(n).padStart(6, '0')}`,
  })
  const set = {
    ...(status ? { status } : {}),
    ...(conclusion ? { conclusion } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
    ...(completedAt ? { completedAt } : {}),
    createdAt: createdAt ?? nextCreatedAt(),
  }
  if (conclusion === 'changes_detected') {
    await seedChangedSnapshots(db, build.id, changedSnapshots ?? [])
  }
  if (Object.keys(set).length === 0) return build
  const [updated] = await db
    .update(schema.builds)
    .set(set)
    .where(eq(schema.builds.id, build.id))
    .returning()
  return updated ?? build
}

/**
 * Gives a build changed snapshots (`changed` diff rows) to review, for tests that mark a build
 * `changes_detected` by hand. Names that already have a row are left as they are.
 */
export async function seedChangedSnapshots(
  db: Database,
  buildId: string,
  names: readonly string[] = ['home'],
): Promise<void> {
  if (names.length === 0) return
  await db
    .insert(schema.screenshotDiffs)
    .values(
      names.map((name) => ({
        buildId,
        name,
        status: 'changed' as const,
        jobStatus: 'done' as const,
      })),
    )
    .onConflictDoNothing()
}
