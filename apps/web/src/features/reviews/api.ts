import type { Review } from '@circi/api'
import type { Status } from '@circi/ui'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { teamPath } from '#lib/api-paths.ts'
import { getJson, post, seg } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'

/**
 * The tabs the data supports today. "Reviewed" (requests you closed) and "All open" (everyone's
 * open requests in the workspace) are on the design board but need server read models first.
 */
export const REVIEW_TABS: readonly { value: Review.Tab; label: string }[] = [
  { value: 'for-you', label: 'Requested from you' },
  { value: 'created', label: 'Created by you' },
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
export const isProcessing = (build: Review.Request['build']) =>
  build.status !== 'complete' && build.status !== 'error' && build.status !== 'expired'

/** The glyph and word for a request's build: processing, needs review, approved or rejected. */
export function requestStatus(r: Review.Request): { status: Status; label: string } {
  if (isProcessing(r.build)) return { status: 'processing', label: 'Processing' }
  if (r.build.reviewStatus === 'approved') return { status: 'approved', label: 'Approved' }
  if (r.build.reviewStatus === 'rejected') return { status: 'rejected', label: 'Rejected' }
  return { status: 'needs-review', label: 'Needs review' }
}

export interface RequestGroup {
  id: string
  label: string
  status: Status
  items: Review.Request[]
}

/** The tab's requests under the headings of the board, empty groups left out. */
export function groupRequests(
  requests: readonly Review.Request[],
  tab: Review.Tab,
): RequestGroup[] {
  const groups: RequestGroup[] =
    tab === 'for-you'
      ? [
          {
            id: 'needs',
            label: 'Needs your review',
            status: 'needs-review',
            items: requests.filter((r) => !isProcessing(r.build)),
          },
          {
            id: 'processing',
            label: 'Still processing',
            status: 'processing',
            items: requests.filter((r) => isProcessing(r.build)),
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
