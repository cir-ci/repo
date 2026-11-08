import type { Review } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg } from '#lib/http.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'

export const REVIEW_TABS: readonly { value: Review.Tab; label: string }[] = [
  { value: 'for-you', label: 'For you' },
  { value: 'created', label: 'Created by you' },
  { value: 'snoozed', label: 'Snoozed' },
]

export interface ReviewsSearch {
  tab: Review.Tab
}

/** The `?tab=` of the page: anything unknown is "For you". */
export function validateReviewsSearch(search: Record<string, unknown>): ReviewsSearch {
  const tab = REVIEW_TABS.find((t) => t.value === search['tab'])
  return { tab: tab?.value ?? 'for-you' }
}

export const reviewsQuery = (tab: Review.Tab) =>
  queryOptions({
    queryKey: ['reviews', tab],
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
    `Build ${r.build.number} of ${r.project.name} on ${requestRef(r.build)}`,
    r.requestedBy ? `asked by ${r.requestedBy.name}` : undefined,
    overdueLabel(r.overdueByMs)?.toLowerCase(),
  ]
    .filter(Boolean)
    .join(', ')
}

/** "3 reviews", "1 review"; what the list announces. */
export const requestCount = (n: number) => `${n} ${n === 1 ? 'review' : 'reviews'}`

const projectPath = (r: Review.Request) => `/api/projects/${seg(r.org.slug)}/${seg(r.project.slug)}`

/** Every list that shows the same facts a review changes; refetched after each of them. */
const AFFECTED = [['reviews'], ['inbox'], ['sidebar'], ['projects']] as const

function useRefresh() {
  const queryClient = useQueryClient()
  return (extra: readonly (readonly unknown[])[] = []) =>
    Promise.all(
      [...AFFECTED, ...extra].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
}

/** Approves the request's build. The server also clears the Inbox entry, so both lists are refetched. */
export function useApproveRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (r: Review.Request) =>
      post(`${projectPath(r)}/builds/${r.build.number}/review`, { state: 'approved' }),
    onSuccess: (_data, r) => refresh([['build', r.org.slug, r.project.slug, r.build.number]]),
  })
}

export function useSnoozeRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ request, choice }: { request: Review.Request; choice: SnoozeChoice }) =>
      post(`${projectPath(request)}/review-requests/${seg(request.id)}/snooze`, choice),
    onSuccess: () => refresh(),
  })
}

export function useUnsnoozeRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (r: Review.Request) =>
      post(`${projectPath(r)}/review-requests/${seg(r.id)}/unsnooze`, {}),
    onSuccess: () => refresh(),
  })
}

export function useDismissRequest() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (r: Review.Request) =>
      post(`${projectPath(r)}/review-requests/${seg(r.id)}/dismiss`, {}),
    onSuccess: () => refresh(),
  })
}

export function useRequestReview() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ request, reviewerId }: { request: Review.Request; reviewerId: string }) =>
      post<Review.Requested>(
        `${projectPath(request)}/builds/${request.build.number}/review-requests`,
        {
          reviewerId,
        },
      ),
    onSuccess: () => refresh(),
  })
}
