import { checkBuildInput, assertFound } from '@circi/core'
import { and, eq, sql } from 'drizzle-orm'

import { builds, teams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/** Creating a build, or joining the parallel build of the same commit. */

/**
 * Creates a build, or joins the existing one for parallel shards (PLAN §7.1 step 4): shards
 * that start at the same moment hit the unique (team, name, commit, nonce) index and all
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
    teamId: input.teamId,
    name,
    commitSha,
    branch: input.branch ?? null,
    prNumber: input.prNumber ?? null,
    baseBranch: input.baseBranch ?? null,
    mergeBaseSha: input.mergeBaseSha?.toLowerCase() ?? null,
    ancestorShas,
    ancestryStatus: input.ancestryStatus ?? (ancestorShas.length > 0 ? 'ok' : 'missing'),
    historySource: input.historySource ?? 'cli',
    status: 'uploading' as const,
    parallelNonce: input.parallel?.nonce ?? null,
    parallelTotal: input.parallel?.total ?? null,
    authorLogin: input.author?.login ?? null,
    authorEmail: input.author?.email ?? null,
    authorUserId: input.author?.userId ?? null,
  }

  return db.transaction(async (tx) => {
    if (input.parallel) {
      const existing = await findParallelBuild(
        tx,
        input.teamId,
        name,
        commitSha,
        input.parallel.nonce,
      )
      if (existing) return existing
    }
    const [counter] = await tx
      .update(teams)
      .set({ buildCounter: sql`${teams.buildCounter} + 1` })
      .where(eq(teams.id, input.teamId))
      .returning({ number: teams.buildCounter })
    assertFound(counter, 'team not found')

    const [created] = await tx
      .insert(builds)
      .values({ ...values, number: counter.number })
      .onConflictDoNothing({
        target: [builds.teamId, builds.name, builds.commitSha, builds.parallelNonce],
        where: sql`${builds.parallelNonce} is not null`,
      })
      .returning()
    if (created) return created
    // Lost the race to a concurrent shard: join its build. (The bumped number stays unused.)
    const joined =
      input.parallel &&
      (await findParallelBuild(tx, input.teamId, name, commitSha, input.parallel.nonce))
    if (!joined) throw new Error('parallel build vanished after conflict')
    return joined
  })
}

export namespace createBuild {
  export interface Input {
    teamId: string
    name?: string
    commitSha: string
    branch?: string | null
    prNumber?: number | null
    baseBranch?: string | null
    mergeBaseSha?: string | null
    ancestorShas?: string[]
    ancestryStatus?: 'ok' | 'missing' | 'truncated'
    /** Who sent `ancestorShas`; `sdk` for an Argos SDK. Default `cli`. */
    historySource?: 'cli' | 'sdk'
    parallel?: { nonce: string; total: number }
    /** Who made the change; `userId` is the member it was matched to (see `startBuild`). */
    author?: { login?: string | null; email?: string | null; userId?: string | null }
  }
}

async function findParallelBuild(
  db: Database,
  teamId: string,
  name: string,
  commitSha: string,
  nonce: string,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(
      and(
        eq(builds.teamId, teamId),
        eq(builds.name, name),
        eq(builds.commitSha, commitSha),
        eq(builds.parallelNonce, nonce),
      ),
    )
  return row
}
