import type { Review } from '@circi/api'
import type { Status } from '@circi/ui'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { teamPath } from '#lib/api-paths.ts'
import { getJson, post, seg } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'

/** The tabs of the page, in the order of the design board. */
export const REVIEW_TABS: readonly { value: Review.Tab; label: string }[] = [
  { value: 'for-you', label: 'Requested from you' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'created', label: 'Created by you' },
  { value: 'all-open', label: 'All open' },
  { value: 'snoozed', label: 'Snoozed' },
]

export interface ReviewsSearch {
  tab: Review.Tab
  /** The selected review request's id, so a link can point at one review. */
  review?: string
}

/** The `?tab=` of the page (anything unknown is "Requested from you") and the `?review=` selected. */
export function validateReviewsSearch(search: Record<string, unknown>): ReviewsSearch {
  const tab = REVIEW_TABS.find((t) => t.value === search['tab'])
  const review = search['review']
  return {
    tab: tab?.value ?? 'for-you',
    ...(typeof review === 'string' && review ? { review } : {}),
  }
}

/** A build the worker is still comparing: nothing to review yet. */
export const isProcessing = (build: Pick<Review.Request['build'], 'status'>) =>
  build.status !== 'complete' && build.status !== 'error' && build.status !== 'expired'

/** The glyph and word for a request's build: processing, needs review, approved or rejected. */
export function requestStatus(r: Review.Request): { status: Status; label: string } {
  return buildStatus(r.build)
}

/** The same for any build with its status and review status (a request's, a notification's). */
export function buildStatus(build: Pick<Review.Request['build'], 'status' | 'reviewStatus'>): {
  status: Status
  label: string
} {
  if (isProcessing(build)) return { status: 'processing', label: 'Processing' }
  if (build.reviewStatus === 'approved') return { status: 'approved', label: 'Approved' }
  if (build.reviewStatus === 'rejected') return { status: 'rejected', label: 'Rejected' }
  return { status: 'needs-review', label: 'Needs review' }
}

export interface RequestGroup {
  id: string
  label: string
  status: Status
  items: Review.Request[]
}

const settled = (r: Review.Request) => !isProcessing(r.build)

/** The tab's requests under the headings of the board, empty groups left out. */
export function groupRequests(
  requests: readonly Review.Request[],
  tab: Review.Tab,
  /** The signed-in person, to tell their requests from the others' on "All open". */
  userId?: string,
): RequestGroup[] {
  const groups: RequestGroup[] =
    tab === 'for-you'
      ? [
          {
            id: 'needs',
            label: 'Needs your review',
            status: 'needs-review',
            items: requests.filter((r) => settled(r) && !r.reason),
          },
          {
            id: 'again',
            label: 'Re-requested',
            status: 'needs-review',
            items: requests.filter((r) => settled(r) && r.reason),
          },
          {
            id: 'processing',
            label: 'Still processing',
            status: 'processing',
            items: requests.filter((r) => isProcessing(r.build)),
          },
        ]
      : tab === 'reviewed'
        ? [{ id: 'reviewed', label: 'Reviewed by you', status: 'approved', items: [...requests] }]
        : tab === 'all-open'
          ? [
              {
                id: 'yours',
                label: 'Requested from you',
                status: 'needs-review',
                items: requests.filter((r) => settled(r) && r.reviewer.id === userId),
              },
              {
                id: 'others',
                label: 'Requested from others',
                status: 'neutral',
                items: requests.filter((r) => settled(r) && r.reviewer.id !== userId),
              },
              {
                id: 'processing',
                label: 'Still processing',
                status: 'processing',
                items: requests.filter((r) => !settled(r)),
              },
            ]
          : tab === 'created'
            ? [
                {
                  id: 'waiting',
                  label: 'Waiting on reviewers',
                  status: 'needs-review',
                  items: [...requests],
                },
              ]
            : [{ id: 'snoozed', label: 'Snoozed', status: 'neutral', items: [...requests] }]
  return groups.filter((g) => g.items.length > 0)
}

/**
 * The chip that says why a request is back: "You rejected #143" (the reviewer's own words when
 * they are the one looking), or "Re-requested". Nothing for a first ask.
 */
export function reasonLabel(r: Review.Request, userId?: string): string | undefined {
  if (!r.reason) return undefined
  if (r.reason.kind === 're_requested') return 'Re-requested'
  const who = r.reviewer.id === userId ? 'You' : r.reviewer.name
  return `${who} rejected #${r.reason.buildNumber}`
}

/** "Approved by you" or "Rejected by you" for a closed request; undefined when open or decided by someone else. */
export function decisionLabel(r: Review.Request): string | undefined {
  if (r.decision === null) return undefined
  return r.decision === 'approved' ? 'Approved by you' : 'Rejected by you'
}

/** "#147 · main", the build a review was compared with; undefined without a baseline. */
export function baselineLabel(r: Review.Request): string | undefined {
  if (!r.baseline) return undefined
  return `#${r.baseline.number}${r.baseline.branch ? ` · ${r.baseline.branch}` : ''}`
}

/** "4 changed, 1 added, 2 removed"; nothing for a build without changes. */
export function changeSummary(changes: Review.Request['changes']): string[] {
  return [
    changes.changed > 0 ? `${changes.changed} changed` : '',
    changes.added > 0 ? `${changes.added} added` : '',
    changes.removed > 0 ? `${changes.removed} removed` : '',
  ].filter(Boolean)
}

/** A diff score as a percentage of the screenshot: "2.4%", "<0.1%"; empty when not measured. */
export function scoreLabel(score: number | null): string {
  if (score === null) return ''
  const pct = score * 100
  return pct > 0 && pct < 0.1 ? '<0.1%' : `${Number(pct.toFixed(1))}%`
}

export const reviewsQuery = (tab: Review.Tab) =>
  queryOptions({
    queryKey: keys.reviews(tab),
    queryFn: () => getJson<Review.List>(`/api/reviews?tab=${seg(tab)}`),
  })

const HOUR = 3600_000
const DAY = 24 * HOUR

/** "Overdue 25m", "Overdue 3h", "Overdue 2d"; undefined for a request that is on time. */
export function overdueLabel(overdueByMs: number): string | undefined {
  if (!(overdueByMs > 0)) return undefined
  if (overdueByMs < HOUR) return `Overdue ${Math.max(1, Math.floor(overdueByMs / 60_000))}m`
  if (overdueByMs < DAY) return `Overdue ${Math.floor(overdueByMs / HOUR)}h`
  return `Overdue ${Math.floor(overdueByMs / DAY)}d`
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/**
 * What a snoozed row says: "Snoozed for 18 hours", "Snoozed for 3 days" (the time left, rounded
 * down); plain "Snoozed" once the time has come and it is about to wake.
 */
export function snoozedLabel(untilIso: string, now: number): string {
  const left = Date.parse(untilIso) - now
  if (!(left >= 60_000)) return 'Snoozed'
  if (left < HOUR) return `Snoozed for ${plural(Math.floor(left / 60_000), 'minute')}`
  if (left < 2 * DAY) return `Snoozed for ${plural(Math.floor(left / HOUR), 'hour')}`
  return `Snoozed for ${plural(Math.floor(left / DAY), 'day')}`
}

/** The branch the row shows: the branch, else the pull request, else the short commit. */
export function requestRef(build: Review.Request['build']): string {
  return (
    build.branch ??
    (build.prNumber === null ? build.commitSha.slice(0, 7) : `PR #${build.prNumber}`)
  )
}

/** What a row is called for screen readers: "Build 12 of Acme / Web on main, asked by Ada, overdue 3h". */
export function requestName(r: Review.Request): string {
  return [
    `Build ${r.build.number} of ${r.team.name} on ${requestRef(r.build)}`,
    r.requestedBy ? `asked by ${r.requestedBy.name}` : undefined,
    overdueLabel(r.overdueByMs)?.toLowerCase(),
  ]
    .filter(Boolean)
    .join(', ')
}

/** "3 reviews", "1 review"; what the list announces. */
export const requestCount = (n: number) => `${n} ${n === 1 ? 'review' : 'reviews'}`

const requestPath = (r: Review.Request, ...rest: (string | number)[]) =>
  teamPath(r.workspace.slug, r.team.slug, ...rest)

/** Every list that shows the same facts a review changes; refetched after each of them. */
const AFFECTED = [keys.reviews(), keys.inbox(), keys.sidebar(), keys.teams()] as const

function useRefresh() {
  const queryClient = useQueryClient()
  return (extra: readonly (readonly unknown[])[] = []) =>
    invalidateAll(queryClient, ...AFFECTED, ...extra)
}

/** Approves the request's build. The server also clears the Inbox entry, so both lists are refetched. */
export function useApproveRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (r: Review.Request) =>
      post(requestPath(r, 'builds', r.build.number, 'review'), { state: 'approved' }),
    onSuccess: (_data, r) => refresh([keys.build(r.workspace.slug, r.team.slug, r.build.number)]),
  })
}

export function useSnoozeRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ request, choice }: { request: Review.Request; choice: SnoozeChoice }) =>
      post(requestPath(request, 'review-requests', request.id, 'snooze'), choice),
    onSuccess: () => refresh(),
  })
}

export function useUnsnoozeRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (r: Review.Request) =>
      post(requestPath(r, 'review-requests', r.id, 'unsnooze'), {}),
    onSuccess: () => refresh(),
  })
}

export function useDismissRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (r: Review.Request) => post(requestPath(r, 'review-requests', r.id, 'dismiss'), {}),
    onSuccess: () => refresh(),
  })
}

export function useRequestReview() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ request, reviewerId }: { request: Review.Request; reviewerId: string }) =>
      post<Review.Requested>(
        requestPath(request, 'builds', request.build.number, 'review-requests'),
        {
          reviewerId,
        },
      ),
    onSuccess: () => refresh(),
  })
}
