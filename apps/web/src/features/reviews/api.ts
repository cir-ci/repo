import type { Build, Inbox, Review } from '@circi/api'
import type { Status } from '@circi/ui'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { askForReview } from '#features/builds/api/discussion.ts'
import { withBuildDecision } from '#features/builds/api/optimistic.ts'
import { withBuildApproved } from '#features/inbox/optimistic.ts'
import {
  withoutRequest,
  withRequestAwake,
  withRequestClosed,
  withRequestSnoozed,
} from '#features/reviews/optimistic.ts'
import { projectPath } from '#lib/api-paths.ts'
import { findParam } from '#lib/find.ts'
import { getJson, post, seg } from '#lib/http.ts'
import { applyPatches, type CachePatch, patchOf, rollback } from '#lib/optimistic.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'

/** The tabs of the page, in the order of the design board. */
export const REVIEW_TABS: readonly { value: Review.Tab; label: string; short: string }[] = [
  { value: 'for-you', label: 'Needs your review', short: 'For you' },
  { value: 'reviewed', label: 'Reviewed', short: 'Reviewed' },
  { value: 'created', label: 'Created by you', short: 'Created' },
  { value: 'all-open', label: 'All open', short: 'All open' },
  { value: 'snoozed', label: 'Snoozed', short: 'Snoozed' },
]

export interface ReviewsSearch {
  tab: Review.Tab
  /** The selected review request's id, so a link can point at one review. */
  review?: string
  /** The find text. */
  q?: string
}

/** What a find text is looked for in: the build, its branch, commit and pull request, the project and the two people. */
export const requestFields = (r: Review.Request) => [
  `Build #${r.build.number} #${r.build.number}`,
  r.build.name === 'default' ? undefined : r.build.name,
  r.build.branch,
  r.build.commitSha,
  r.build.prNumber === null ? undefined : `PR #${r.build.prNumber}`,
  r.project.name,
  r.reviewer.name,
  r.requestedBy?.name,
]

/** The `?tab=` of the page (anything unknown is "Requested from you"), the `?review=` selected and the `?q=` find text. */
export function validateReviewsSearch(search: Record<string, unknown>): ReviewsSearch {
  const tab = REVIEW_TABS.find((t) => t.value === search['tab'])
  const review = search['review']
  const q = findParam(search['q']).trim()
  return {
    tab: tab?.value ?? 'for-you',
    ...(q ? { q } : {}),
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
  if (build.status === 'pending' || build.status === 'uploading')
    return { status: 'uploading', label: 'Uploading' }
  if (isProcessing(build)) return { status: 'processing', label: 'Processing' }
  if (build.status === 'expired') return { status: 'expired', label: 'Expired' }
  if (build.status === 'error') return { status: 'failed', label: 'Failed' }
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
/** The size groups of a review's changes, largest first: how far above the project's threshold. */
const SIZE_GROUPS = [
  { size: 'large', label: 'Large', above: 0.3 },
  { size: 'medium', label: 'Medium', above: 0.15 },
  { size: 'small', label: 'Small', above: 0 },
] as const

const sizeOf = (score: number | null, threshold: number) =>
  score === null
    ? 'unmeasured'
    : (SIZE_GROUPS.find((g) => score >= threshold + g.above)?.size ?? 'small')

/**
 * A review's changed screenshots grouped by how much of each changed, measured from the
 * project's diff threshold (its minimum change, 0 to 1): Large at the threshold + 30 points or
 * more, Medium at + 15, Small below that, then Not measured. Empty groups are left out, and each
 * keeps the order it was given (biggest first).
 */
export function changeSizeGroups<T extends { score: number | null }>(
  changes: readonly T[],
  threshold: number,
): changeSizeGroups.Group<T>[] {
  const groups: changeSizeGroups.Group<T>[] = [
    ...SIZE_GROUPS.map((g) => ({ size: g.size, label: g.label, items: [] as T[] })),
    { size: 'unmeasured', label: 'Not measured', items: [] },
  ]
  for (const c of changes) groups.find((g) => g.size === sizeOf(c.score, threshold))?.items.push(c)
  return groups.filter((g) => g.items.length > 0)
}

export namespace changeSizeGroups {
  export interface Group<T> {
    size: 'large' | 'medium' | 'small' | 'unmeasured'
    label: string
    items: T[]
  }
}

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
    `Build ${r.build.number} of ${r.project.name} on ${requestRef(r.build)}`,
    r.requestedBy ? `asked by ${r.requestedBy.name}` : undefined,
    overdueLabel(r.overdueByMs)?.toLowerCase(),
  ]
    .filter(Boolean)
    .join(', ')
}

/** The row's title: "Build #148", with the build's name after it unless it is the default one. */
export function requestTitle(r: Review.Request): string {
  return r.build.name === 'default'
    ? `Build #${r.build.number}`
    : `Build #${r.build.number} · ${r.build.name}`
}

/**
 * Whether this person asked for the review and it waits on somebody else: the request shows
 * who it waits on, and can be nudged, instead of being theirs to approve.
 */
export const isWaitingOnOther = (r: Review.Request, userId: string | undefined) =>
  userId !== undefined && r.reviewer.id !== userId && r.requestedBy?.id === userId

/** A first name for a button: "Nudge Dana". */
export const firstName = (name: string) => name.split(/\s+/)[0] ?? name

/** "3 reviews", "1 review"; what the list announces. */
export const requestCount = (n: number) => `${n} ${n === 1 ? 'review' : 'reviews'}`

const requestPath = (r: Review.Request, ...rest: (string | number)[]) =>
  projectPath(r.workspace.slug, r.project.slug, ...rest)

/** Every list that shows the same facts a review changes; refetched after each of them. */
const AFFECTED = [keys.reviews(), keys.inbox(), keys.sidebar(), keys.projects()] as const

/**
 * A change to a review request: the cached lists show it at once (`patch`, applied to every tab)
 * and go back if the server says no; everything that shows the same facts is refetched when it
 * settles. `also` adds patches to other caches (the build's page).
 */
function useRequestMutation<V extends Review.Request, R>(
  what: string,
  mutationFn: (vars: V) => Promise<R>,
  patch: (list: Review.List, vars: V) => Review.List,
  also: (vars: V) => readonly CachePatch[] = () => [],
) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what },
    mutationFn,
    onMutate: (vars: V) =>
      applyPatches(queryClient, [
        patchOf<Review.List>(keys.reviews(), (list) => patch(list, vars)),
        ...also(vars),
      ]),
    onError: (_error, _vars, snapshot) => rollback(queryClient, snapshot),
    onSettled: (_data, _error, r) =>
      invalidateAll(
        queryClient,
        ...AFFECTED,
        keys.build(r.workspace.slug, r.project.slug, r.build.number),
      ),
  })
}

/** Approves the request's build. The server also clears the Inbox entry, so both lists are refetched. */
export function useApproveRequest() {
  return useRequestMutation(
    'approve',
    (r: Review.Request) =>
      post<Review.Decided>(requestPath(r, 'builds', r.build.number, 'review'), {
        state: 'approved',
      }),
    (list, r) => withRequestClosed(list, r.id),
    (r) => [
      patchOf<Build.Detail>(keys.build(r.workspace.slug, r.project.slug, r.build.number), (d) =>
        withBuildDecision(d, 'approved'),
      ),
      patchOf<Inbox.List>(keys.inbox(), (list) =>
        withBuildApproved(list, {
          workspace: r.workspace.slug,
          project: r.project.slug,
          number: r.build.number,
        }),
      ),
    ],
  )
}

export function useSnoozeRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'snooze the request' },
    mutationFn: ({ request, choice }: { request: Review.Request; choice: SnoozeChoice }) =>
      post<Review.Snoozed>(requestPath(request, 'review-requests', request.id, 'snooze'), choice),
    onMutate: ({ request, choice }) =>
      applyPatches(queryClient, [
        patchOf<Review.List>(keys.reviews(), (list) =>
          withRequestSnoozed(list, request.id, choice),
        ),
      ]),
    onError: (_error, _vars, snapshot) => rollback(queryClient, snapshot),
    onSettled: () => invalidateAll(queryClient, ...AFFECTED),
  })
}

export function useUnsnoozeRequest() {
  return useRequestMutation(
    'unsnooze the request',
    (r: Review.Request) =>
      post<Review.Snoozed>(requestPath(r, 'review-requests', r.id, 'unsnooze'), {}),
    (list, r) => withRequestAwake(list, r.id),
  )
}

/** Tells the reviewer again; the server allows it once per 24 hours, and only to whoever asked. */
export function useNudgeRequest() {
  return useMutation({
    meta: { what: 'nudge' },
    mutationFn: (r: Review.Request) => post(requestPath(r, 'review-requests', r.id, 'nudge'), {}),
  })
}

export function useDismissRequest() {
  return useRequestMutation(
    'dismiss the request',
    (r: Review.Request) => post(requestPath(r, 'review-requests', r.id, 'dismiss'), {}),
    (list, r) => withoutRequest(list, r.id),
  )
}

export function useRequestReview() {
  const queryClient = useQueryClient()
  const refresh = () => invalidateAll(queryClient, ...AFFECTED)
  return useMutation({
    meta: { what: 'ask for a review' },
    mutationFn: ({ request, reviewerId }: { request: Review.Request; reviewerId: string }) =>
      askForReview(
        queryClient,
        {
          workspace: request.workspace.slug,
          project: request.project.slug,
          number: request.build.number,
        },
        reviewerId,
      ),
    onSuccess: () => refresh(),
  })
}
