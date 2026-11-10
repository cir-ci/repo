import type { Activity, Comment, ReviewRequestState } from '@circi/api'
import type { Status } from '@circi/ui'

/** One line of the Activity tab, ready to draw. */
export interface TimelineItem {
  key: string
  at: string
  /** The glyph's state. */
  status: Status
  /** The person to show an avatar for; null for what the system did. */
  actor: string | null
  /** The sentence, without the actor's name (drawn in bold before it). */
  text: string
  /** A review's reason or a comment's text, quoted under the sentence. */
  quote: string | null
  /** A comment: the id to jump to in the Comments tab. */
  commentId: string | null
}

const SNIPPET = 140

const snippet = (body: string) => (body.length > SNIPPET ? `${body.slice(0, SNIPPET - 1)}…` : body)

/** Turns the route's events into display items; an event of a kind we don't know yet is skipped. */
export function timelineItems(events: readonly Activity.Event[]): TimelineItem[] {
  const items: TimelineItem[] = []
  events.forEach((e, i) => {
    const base = { key: `${i}-${e.type}`, at: e.at, quote: null, commentId: null, actor: null }
    switch (e.type) {
      case 'uploaded':
        items.push({ ...base, status: 'neutral', text: 'Build uploaded' })
        break
      case 'processing':
        items.push({ ...base, status: 'processing', text: 'Processing screenshots' })
        break
      case 'completed':
        items.push({ ...base, status: 'neutral', text: 'Build finished processing' })
        break
      case 'failed':
        items.push({
          ...base,
          status: 'rejected',
          text: 'Build failed',
          quote: e.message,
        })
        break
      case 'check_created':
        items.push({ ...base, status: 'neutral', text: 'Check created on the pull request' })
        break
      case 'review_requested':
        items.push({
          ...base,
          status: 'needs-review',
          actor: e.by?.name ?? null,
          text: `${e.by ? 'requested' : 'Review requested from'} ${e.reviewer?.name ?? 'someone who has left'}${e.by ? ' to review' : ''}`,
        })
        break
      case 'review_request_closed':
        items.push({
          ...base,
          status: 'neutral',
          text: `Review request for ${e.reviewer?.name ?? 'someone who has left'} ${REQUEST_CLOSED[e.state]}`,
        })
        break
      case 'review':
        items.push({
          ...base,
          status: e.state,
          actor: e.source === 'auto' || e.source === 'rerun' ? null : (e.by?.name ?? null),
          text: reviewText(e),
          quote: e.reason,
        })
        break
      case 'snapshot_review':
        items.push({
          ...base,
          status: e.decision,
          actor: e.by?.name ?? null,
          text: snapshotReviewText(e),
          quote: e.reason ?? (e.snapshotNames.length > 1 ? e.snapshotNames.join(', ') : null),
        })
        break
      case 'comment':
        items.push({
          ...base,
          status: 'neutral',
          actor: e.by?.name ?? null,
          text: `${e.parentId ? 'replied' : 'commented'}${e.snapshotName ? ` on ${e.snapshotName}` : ''}`,
          quote: snippet(e.body),
          commentId: e.commentId,
        })
        break
      case 'issue_created':
        items.push({
          ...base,
          status: 'neutral',
          actor: e.by?.name ?? null,
          text: `created issue ${e.issue.key}${e.snapshotName ? ` for ${e.snapshotName}` : ''}`,
          quote: e.issue.title,
        })
        break
    }
  })
  return items
}

const REQUEST_CLOSED: Record<ReviewRequestState, string> = {
  open: 'is open',
  done: 'was answered',
  superseded: 'was replaced by a new push',
  dismissed: 'was dropped',
}

function snapshotReviewText(e: Activity.Event & { type: 'snapshot_review' }): string {
  const verb = e.decision === 'approved' ? 'approved' : 'rejected'
  const what =
    e.snapshotNames.length === 1 ? e.snapshotNames[0] : `${e.snapshotNames.length} screenshots`
  return e.by ? `${verb} ${what}` : `${what} ${verb} by someone who has left`
}

function reviewText(e: Activity.Event & { type: 'review' }): string {
  const verb = e.state === 'approved' ? 'approved' : 'rejected'
  if (e.source === 'auto') return 'Approved automatically: a build on the default branch'
  if (e.source === 'rerun')
    return 'Approved automatically: these exact screenshots were approved before'
  return e.by ? `${verb} the build` : `Build ${verb} by someone who has left`
}

/** A thread: a top-level comment and its replies, oldest first. */
export interface Thread {
  root: Comment.Item
  replies: Comment.Item[]
}

/**
 * The comments grouped into threads in the order they were started. A reply whose parent isn't
 * in the list is dropped; a deleted comment stays when it holds replies (so they keep their
 * place) and goes when it is alone.
 */
export function groupThreads(comments: readonly Comment.Item[]): Thread[] {
  const roots = comments.filter((c) => c.parentId === null)
  return roots
    .map((root) => ({
      root,
      replies: comments.filter((c) => c.parentId === root.id && c.deletedAt === null),
    }))
    .filter((t) => t.root.deletedAt === null || t.replies.length > 0)
}

/** "1 comment", "3 comments": what the tab and the empty state say. */
export const commentCount = (comments: readonly Comment.Item[]) =>
  comments.filter((c) => c.deletedAt === null).length
