import { isSnoozed, overdueBy } from '@circi/core'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm'

import { workspaceAccepts, type SessionMethod } from '#repositories/auth-settings.ts'
import {
  builds,
  member,
  workspace,
  teams,
  type ReviewRequestState,
  reviewRequests,
  type SnoozeKind,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/**
 * The review requests a person sees on the Reviews page, across the workspaces they belong
 * to (PLAN §8: workspace isolation). Open requests only; closed ones are history.
 */

/** `for-you`: asked of you and awake. `created`: asked by you. `snoozed`: asked of you, put off. */
export const REVIEW_TABS = ['for-you', 'created', 'snoozed'] as const
export namespace listReviewRequests {
  export type Tab = (typeof REVIEW_TABS)[number]

  export interface Item {
    id: string
    state: ReviewRequestState
    createdAt: Date
    /** When the team's review target runs out; null when the team has none. */
    dueAt: Date | null
    /** Milliseconds past `dueAt`; 0 when on time, snoozed or without a target. */
    overdueByMs: number
    snoozedUntil: Date | null
    snoozeKind: SnoozeKind | null
    reviewer: { id: string; name: string }
    /** Null when whoever asked has since left. */
    requestedBy: { id: string; name: string } | null
    build: {
      number: number
      branch: string | null
      prNumber: number | null
      commitSha: string
      status: Build['status']
      conclusion: Build['conclusion']
      reviewStatus: Build['reviewStatus']
    }
    team: { slug: string; name: string }
    workspace: { slug: string; name: string }
  }
}

/**
 * One tab of the Reviews page, most urgent first: soonest due, requests without a due time last,
 * then newest. `now` decides what is snoozed and overdue.
 */
export async function listReviewRequests(
  db: Database,
  input: { userId: string; tab: listReviewRequests.Tab; now: Date; method?: SessionMethod },
): Promise<listReviewRequests.Item[]> {
  const snoozed =
    and(
      isNotNull(reviewRequests.snoozeKind),
      or(isNull(reviewRequests.snoozedUntil), gt(reviewRequests.snoozedUntil, input.now)),
    ) ?? sql`false`
  const scope =
    input.tab === 'created'
      ? eq(reviewRequests.requestedById, input.userId)
      : and(
          eq(reviewRequests.reviewerId, input.userId),
          input.tab === 'snoozed' ? snoozed : not(snoozed),
        )

  const rows = await db
    .select({
      request: reviewRequests,
      reviewer: { id: user.id, name: user.name },
      build: {
        number: builds.number,
        branch: builds.branch,
        prNumber: builds.prNumber,
        commitSha: builds.commitSha,
        status: builds.status,
        conclusion: builds.conclusion,
        reviewStatus: builds.reviewStatus,
      },
      team: { slug: teams.slug, name: teams.name },
      workspace: { slug: workspace.slug, name: workspace.name },
    })
    .from(reviewRequests)
    .innerJoin(builds, eq(builds.id, reviewRequests.buildId))
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .innerJoin(user, eq(user.id, reviewRequests.reviewerId))
    .where(
      and(eq(reviewRequests.state, 'open'), scope, workspaceAccepts(workspace.id, input.method)),
    )
    .orderBy(
      sql`${reviewRequests.dueAt} asc nulls last`,
      desc(reviewRequests.createdAt),
      asc(reviewRequests.id),
    )

  // Looked up apart from the rows: joining the user table twice, once optionally, makes
  // Drizzle's result type collapse.
  const askerIds = [...new Set(rows.flatMap((r) => r.request.requestedById ?? []))]
  const askers = new Map(
    askerIds.length === 0
      ? []
      : (
          await db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, askerIds))
        ).map((u) => [u.id, u.name]),
  )

  return rows.map((r) => {
    const asleep = isSnoozed(r.request, input.now)
    return {
      id: r.request.id,
      state: r.request.state,
      createdAt: r.request.createdAt,
      dueAt: r.request.dueAt,
      overdueByMs: overdueBy(r.request.dueAt, input.now, asleep),
      snoozedUntil: r.request.snoozedUntil,
      snoozeKind: r.request.snoozeKind,
      reviewer: r.reviewer,
      requestedBy: askerOf(r.request.requestedById, askers),
      build: r.build,
      team: r.team,
      workspace: r.workspace,
    }
  })
}

function askerOf(id: string | null, names: Map<string, string>) {
  const name = id === null ? undefined : names.get(id)
  return id !== null && name !== undefined ? { id, name } : null
}
