import { ISSUE_LINK_KIND } from '@circi/core'
import { and, aliasedTable, eq, isNull } from 'drizzle-orm'

import { listBuildLinks } from '#repositories/integration-links.ts'
import {
  builds,
  buildChecks,
  comments,
  type ReviewRequestState,
  reviewRequests,
  reviews,
  snapshotReviews,
  type ReviewSource,
  type ReviewState,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * A build's activity: one list, oldest first, put together from the tables that each keep their
 * own history (build lifecycle, check run, review requests, decisions, comments, issues created).
 */

interface Actor {
  id: string
  name: string
}

export type ActivityEvent = { at: Date } & (
  | { type: 'uploaded' }
  | { type: 'processing' }
  | { type: 'completed' }
  | { type: 'failed'; message: string | null }
  | { type: 'check_created' }
  | { type: 'review_requested'; reviewer: Actor | null; by: Actor | null }
  | { type: 'review_request_closed'; reviewer: Actor | null; state: ReviewRequestState }
  | {
      type: 'review'
      state: ReviewState
      source: ReviewSource
      reason: string | null
      /** Null for automatic approvals, or when the reviewer's account was deleted. */
      by: Actor | null
    }
  | {
      type: 'snapshot_review'
      decision: ReviewState
      snapshotNames: string[]
      reason: string | null
      by: Actor | null
    }
  | {
      type: 'comment'
      commentId: string
      parentId: string | null
      snapshotName: string | null
      body: string
      by: Actor | null
    }
  | {
      type: 'issue_created'
      issue: { key: string; url: string; title: string; tracker: string }
      snapshotName: string | null
      by: Actor | null
    }
)

const actor = (id: string | null, name: string | null): Actor | null =>
  id && name !== null ? { id, name } : null

/** Oldest first; events at the same instant keep a fixed order (lifecycle, requests, reviews, comments). */
export async function listBuildActivity(db: Database, buildId: string): Promise<ActivityEvent[]> {
  const [build] = await db.select().from(builds).where(eq(builds.id, buildId))
  if (!build) return []
  const events: ActivityEvent[] = [{ type: 'uploaded', at: build.createdAt }]
  if (build.finalizedAt) events.push({ type: 'processing', at: build.finalizedAt })
  if (build.completedAt) {
    events.push(
      build.status === 'error'
        ? { type: 'failed', at: build.completedAt, message: build.errorMessage }
        : { type: 'completed', at: build.completedAt },
    )
  }
  const [check] = await db.select().from(buildChecks).where(eq(buildChecks.buildId, buildId))
  if (check) events.push({ type: 'check_created', at: check.createdAt })

  const requester = aliasedTable(user, 'requester')
  const requests = await db
    .select({ request: reviewRequests, reviewerName: user.name, requesterName: requester.name })
    .from(reviewRequests)
    .leftJoin(user, eq(user.id, reviewRequests.reviewerId))
    .leftJoin(requester, eq(requester.id, reviewRequests.requestedById))
    .where(eq(reviewRequests.buildId, buildId))
  for (const { request: r, reviewerName, requesterName } of requests) {
    const who = actor(r.reviewerId, reviewerName)
    events.push({
      type: 'review_requested',
      at: r.createdAt,
      reviewer: who,
      by: actor(r.requestedById, requesterName),
    })
    if (r.closedAt && r.state !== 'open') {
      events.push({ type: 'review_request_closed', at: r.closedAt, reviewer: who, state: r.state })
    }
  }

  // Snapshot decisions by people; one action that decided several snapshots is one event.
  const snapshotDecisions = await db
    .select({ review: snapshotReviews, name: user.name })
    .from(snapshotReviews)
    .leftJoin(user, eq(user.id, snapshotReviews.userId))
    .where(eq(snapshotReviews.buildId, buildId))
    .orderBy(snapshotReviews.createdAt, snapshotReviews.snapshotName)
  const grouped = new Map<string, Extract<ActivityEvent, { type: 'snapshot_review' }>>()
  for (const { review: r, name } of snapshotDecisions) {
    if (r.source === 'auto' || r.source === 'rerun') continue
    const key = `${r.createdAt.getTime()}|${r.userId ?? ''}|${r.decision}`
    const event = grouped.get(key)
    if (event) {
      event.snapshotNames.push(r.snapshotName)
      if (!event.reason && r.reason) event.reason = r.reason
    } else {
      grouped.set(key, {
        type: 'snapshot_review',
        at: r.createdAt,
        decision: r.decision,
        snapshotNames: [r.snapshotName],
        reason: r.reason,
        by: actor(r.userId, name),
      })
    }
  }
  events.push(...grouped.values())

  const decisions = await db
    .select({ review: reviews, name: user.name })
    .from(reviews)
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(eq(reviews.buildId, buildId))
  for (const { review: r, name } of decisions) {
    events.push({
      type: 'review',
      at: r.createdAt,
      state: r.state,
      source: r.source,
      reason: r.reason,
      by: actor(r.userId, name),
    })
  }

  const notes = await db
    .select({ comment: comments, name: user.name })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorId))
    .where(and(eq(comments.buildId, buildId), isNull(comments.deletedAt)))
  for (const { comment: c, name } of notes) {
    events.push({
      type: 'comment',
      at: c.createdAt,
      commentId: c.id,
      parentId: c.parentId,
      snapshotName: c.snapshotName,
      body: c.body,
      by: actor(c.authorId, name),
    })
  }

  for (const link of await listBuildLinks(db, buildId, ISSUE_LINK_KIND)) {
    const snapshotName = link.payload.snapshotName
    events.push({
      type: 'issue_created',
      at: link.createdAt,
      issue: {
        key: link.externalRef,
        url: link.url ?? '',
        title: link.title ?? link.externalRef,
        tracker: link.integrationKind,
      },
      snapshotName: typeof snapshotName === 'string' ? snapshotName : null,
      by: actor(link.createdBy, link.createdByName),
    })
  }

  // toSorted is stable, so equal instants keep the order they were pushed in.
  return events.toSorted((a, b) => a.at.getTime() - b.at.getTime())
}
