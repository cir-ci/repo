import { aliasedTable, and, desc, eq, inArray, isNull, lte } from 'drizzle-orm'

import {
  type BuildStatus,
  builds,
  type DiffStatus,
  files,
  type ReviewStatus,
  reviews,
  screenshotDiffs,
  screenshots,
  snapshotReviews,
  teams,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** One snapshot's recent history, for the triage filmstrip: read-only, shaped for the UI. */

export namespace getSnapshotHistory {
  export interface Entry {
    build: {
      number: number
      branch: string | null
      status: BuildStatus
      reviewStatus: ReviewStatus
      createdAt: Date
    }
    /** How the snapshot compared in that build; null while it is not compared yet. */
    status: DiffStatus | null
    /**
     * Who approved the snapshot there: its own approval, else the build's latest; null when
     * nobody did (an automatic approval, or still pending).
     */
    approvedBy: { id: string; name: string } | null
    /** The screenshot in that build (the baseline's for a removed one); null when there is none. */
    image: {
      sha256: string
      thumbnail: string | null
      width: number | null
      height: number | null
    } | null
  }

  export interface Result {
    defaultBranch: string
    /** The newest builds on the default branch that have the snapshot, newest first. */
    default: Entry[]
    /** Same for the viewed branch; null when none was asked for, or it is the default branch. */
    branch: Entry[] | null
  }
}

export const SNAPSHOT_HISTORY_MAX = 20

/**
 * The last `limit` builds (default 5, at most 20) that have a snapshot called `name`, on the
 * team's default branch and, when `branch` differs from it, on that branch too. With `build`
 * the default branch list is anchored there: it starts at that build (a triage item's own).
 */
export async function getSnapshotHistory(
  db: Database,
  input: {
    teamId: string
    name: string
    branch?: string | null
    limit?: number
    /** Anchor: only builds up to and including this number, so the list starts at that build. */
    build?: number
  },
): Promise<getSnapshotHistory.Result | undefined> {
  const [team] = await db.select().from(teams).where(eq(teams.id, input.teamId))
  if (!team) return undefined
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 5), 1), SNAPSHOT_HISTORY_MAX)

  const head = aliasedTable(screenshots, 'head')
  const base = aliasedTable(screenshots, 'base')
  const headFile = aliasedTable(files, 'head_file')
  const baseFile = aliasedTable(files, 'base_file')
  const onBranch = async (branch: string, upTo?: number): Promise<getSnapshotHistory.Entry[]> => {
    const rows = await db
      .select({
        buildId: builds.id,
        build: {
          number: builds.number,
          branch: builds.branch,
          status: builds.status,
          reviewStatus: builds.reviewStatus,
          createdAt: builds.createdAt,
        },
        status: screenshotDiffs.status,
        head: { sha256: head.fileSha256, thumbnail: head.thumbnailSha256 },
        headDims: { width: headFile.width, height: headFile.height },
        base: { sha256: base.fileSha256, thumbnail: base.thumbnailSha256 },
        baseDims: { width: baseFile.width, height: baseFile.height },
      })
      .from(screenshotDiffs)
      .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
      .leftJoin(head, eq(head.id, screenshotDiffs.headScreenshotId))
      .leftJoin(base, eq(base.id, screenshotDiffs.baseScreenshotId))
      .leftJoin(headFile, eq(headFile.sha256, head.fileSha256))
      .leftJoin(baseFile, eq(baseFile.sha256, base.fileSha256))
      .where(
        and(
          eq(builds.teamId, team.id),
          eq(builds.branch, branch),
          eq(screenshotDiffs.name, input.name),
          upTo === undefined ? undefined : lte(builds.number, upTo),
        ),
      )
      .orderBy(desc(builds.number))
      .limit(limit)
    const approvers = await approversOf(
      db,
      rows.map((r) => r.buildId),
      input.name,
    )
    return rows.map((r) => {
      const useHead = Boolean(r.head?.sha256)
      const shown = useHead ? r.head : r.base
      const dims = useHead ? r.headDims : r.baseDims
      return {
        build: r.build,
        status: r.status,
        approvedBy: approvers.get(r.buildId) ?? null,
        image: shown?.sha256
          ? {
              sha256: shown.sha256,
              thumbnail: shown.thumbnail,
              width: dims?.width ?? null,
              height: dims?.height ?? null,
            }
          : null,
      }
    })
  }

  const viewed = input.branch && input.branch !== team.defaultBranch ? input.branch : null
  return {
    defaultBranch: team.defaultBranch,
    default: await onBranch(team.defaultBranch, input.build),
    branch: viewed ? await onBranch(viewed) : null,
  }
}

/** Who approved `name` in each build: the snapshot's own approval, else the build's latest one. */
async function approversOf(
  db: Database,
  buildIds: string[],
  name: string,
): Promise<Map<string, { id: string; name: string }>> {
  const result = new Map<string, { id: string; name: string }>()
  if (buildIds.length === 0) return result
  const own = await db
    .select({ buildId: snapshotReviews.buildId, userId: snapshotReviews.userId })
    .from(snapshotReviews)
    .where(
      and(
        inArray(snapshotReviews.buildId, buildIds),
        eq(snapshotReviews.snapshotName, name),
        eq(snapshotReviews.decision, 'approved'),
        isNull(snapshotReviews.supersededAt),
      ),
    )
  const ofBuild = await db
    .select({ buildId: reviews.buildId, userId: reviews.userId })
    .from(reviews)
    .where(and(inArray(reviews.buildId, buildIds), eq(reviews.state, 'approved')))
    .orderBy(desc(reviews.createdAt))
  const userIds = new Map<string, string>()
  for (const r of ofBuild) if (r.userId) userIds.set(r.buildId, r.userId)
  for (const r of own) if (r.userId) userIds.set(r.buildId, r.userId)
  const found = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...new Set(userIds.values())]))
  const names = new Map(found.map((u) => [u.id, u.name]))
  for (const [buildId, id] of userIds) {
    const n = names.get(id)
    if (n !== undefined) result.set(buildId, { id, name: n })
  }
  return result
}
