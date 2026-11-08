import { type Build, createBuild, type Database, schema } from '@circi/db'
import { eq } from 'drizzle-orm'

let n = 0

export namespace seedBuild {
  export interface Input extends Omit<createBuild.Input, 'projectId' | 'commitSha'> {
    commitSha?: string
    /** Set after creation, for builds that should already be past `uploading`. */
    status?: Build['status']
    conclusion?: Build['conclusion']
    reviewStatus?: Build['reviewStatus']
    completedAt?: Date
    createdAt?: Date
  }
}

/** A build in `projectId`, created through `createBuild` (so numbering and counters are real). */
export async function seedBuild(
  db: Database,
  projectId: string,
  input: seedBuild.Input = {},
): Promise<Build> {
  n += 1
  const { status, conclusion, reviewStatus, completedAt, createdAt, commitSha, ...rest } = input
  const build = await createBuild(db, {
    ...rest,
    projectId,
    commitSha: commitSha ?? `abc${String(n).padStart(6, '0')}`,
  })
  const set = {
    ...(status ? { status } : {}),
    ...(conclusion ? { conclusion } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(createdAt ? { createdAt } : {}),
  }
  if (Object.keys(set).length === 0) return build
  const [updated] = await db
    .update(schema.builds)
    .set(set)
    .where(eq(schema.builds.id, build.id))
    .returning()
  return updated ?? build
}
