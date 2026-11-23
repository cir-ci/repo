import { checkBuildInput, assertFound } from '@circi/core'
import { and, eq, sql } from 'drizzle-orm'

import { builds, projects } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/** Creating a build, or joining the parallel build of the same commit. */

/**
 * Creates a build, or joins the existing one for parallel shards (PLAN §7.1 step 4): shards
 * that start at the same moment hit the unique (project, name, commit, nonce) index and all
 * get the same build.
 */
export async function createBuild(db: Database, input: createBuild.Input): Promise<Build> {
  const { name, commitSha, ancestorShas } = checkBuildInput({
    name: input.name,
    commitSha: input.commitSha,
    ancestorShas: input.ancestorShas,
    parallelTotal: input.parallel?.total,
  })

  const values = {
    projectId: input.projectId,
    name,
    commitSha,
    branch: input.branch ?? null,
    prNumber: input.prNumber ?? null,
    baseBranch: input.baseBranch ?? null,
    mergeBaseSha: input.mergeBaseSha?.toLowerCase() ?? null,
    ancestorShas,
    ancestryStatus: input.ancestryStatus ?? (ancestorShas.length > 0 ? 'ok' : 'missing'),
    status: 'uploading' as const,
    idempotencyKey: input.idempotencyKey ?? null,
    parallelNonce: input.parallel?.nonce ?? null,
    parallelTotal: input.parallel?.total ?? null,
    authorLogin: input.author?.login ?? null,
    authorEmail: input.author?.email ?? null,
    authorUserId: input.author?.userId ?? null,
  }

  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      // The same request sent again (its answer was lost): the build it made is the answer.
      const earlier = await findByIdempotencyKey(tx, input.projectId, input.idempotencyKey)
      if (earlier) return earlier
    }
    if (input.parallel) {
      const existing = await findParallelBuild(
        tx,
        input.projectId,
        name,
        commitSha,
        input.parallel.nonce,
      )
      if (existing) return existing
    }
    const [counter] = await tx
      .update(projects)
      .set({ buildCounter: sql`${projects.buildCounter} + 1` })
      .where(eq(projects.id, input.projectId))
      .returning({ number: projects.buildCounter })
    assertFound(counter, 'project not found')

    const [created] = await tx
      .insert(builds)
      .values({ ...values, number: counter.number })
      .onConflictDoNothing()
      .returning()
    if (created) return created
    // Lost the race to the same request sent twice at once.
    if (input.idempotencyKey) {
      const twin = await findByIdempotencyKey(tx, input.projectId, input.idempotencyKey)
      if (twin) return twin
    }
    // Lost the race to a concurrent shard: join its build. (The bumped number stays unused.)
    const joined =
      input.parallel &&
      (await findParallelBuild(tx, input.projectId, name, commitSha, input.parallel.nonce))
    if (!joined) throw new Error('build vanished after conflict')
    return joined
  })
}

export namespace createBuild {
  export interface Input {
    projectId: string
    name?: string
    commitSha: string
    branch?: string | null
    prNumber?: number | null
    baseBranch?: string | null
    mergeBaseSha?: string | null
    ancestorShas?: string[]
    ancestryStatus?: 'ok' | 'missing' | 'truncated'
    /** A client-chosen key: sending the same one again returns the build it first created. */
    idempotencyKey?: string
    parallel?: { nonce: string; total: number }
    /** Who made the change; `userId` is the member it was matched to (see `startBuild`). */
    author?: { login?: string | null; email?: string | null; userId?: string | null }
  }
}

async function findParallelBuild(
  db: Database,
  projectId: string,
  name: string,
  commitSha: string,
  nonce: string,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(
      and(
        eq(builds.projectId, projectId),
        eq(builds.name, name),
        eq(builds.commitSha, commitSha),
        eq(builds.parallelNonce, nonce),
      ),
    )
  return row
}

async function findByIdempotencyKey(
  db: Database,
  projectId: string,
  key: string,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.idempotencyKey, key)))
  return row
}
