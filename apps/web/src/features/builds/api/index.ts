import type { Build, Flaky, Review, ReviewState } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { projectPath } from '#lib/api-paths.ts'
import { signedFileQuery } from '#lib/file-signatures.ts'
import { getJson, post } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** Builds still being uploaded or processed; their pages poll until they finish. */
export const isActive = (status: string) =>
  status === 'pending' || status === 'uploading' || status === 'processing'

export const buildQuery = (workspace: string, project: string, number: number) =>
  queryOptions({
    queryKey: keys.build(workspace, project, number),
    queryFn: () => getJson<Build.Detail>(projectPath(workspace, project, 'builds', number)),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.build.status) ? 2_000 : false),
  })

/**
 * The screenshots that keep changing on the default branch, so the review list can set them
 * aside. Same key and shape as the project page's, so the two share a cache entry.
 */
export const flakyQuery = (workspace: string, project: string) =>
  queryOptions({
    queryKey: keys.flaky(workspace, project),
    queryFn: () => getJson<Flaky.Report>(projectPath(workspace, project, 'flaky')),
  })

/** A file's address without a signature: it works only while signed in (also what goes into links outside the dashboard). */
export const filePath = (sha256: string) => `/api/files/${sha256}`

/** A file's address for the dashboard's own pages: signed when the server sent a signature for it. */
export const fileUrl = (sha256: string) => `${filePath(sha256)}${signedFileQuery(sha256)}`

/** A decision on a build; rejecting carries the reason the author will read. */
export interface Decision {
  state: ReviewState
  reason?: string
}

/** A decision on some snapshots of a build; rejecting carries the reason the author will read. */
export interface SnapshotDecision {
  snapshotNames: string[]
  decision: ReviewState
  reason?: string
}

/**
 * Approve or reject snapshots of a build. The build's own status follows from the decisions, so
 * afterwards everything that shows it is refetched, as for `useReviewBuild`.
 */
export function useReviewSnapshots(workspace: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'review the screenshots' },
    mutationFn: ({ snapshotNames, decision, reason }: SnapshotDecision) =>
      post<Review.Decided>(
        projectPath(workspace, project, 'builds', number, 'snapshots', 'review'),
        reason ? { snapshotNames, decision, reason } : { snapshotNames, decision },
      ),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.build(workspace, project, number),
        keys.project(workspace, project),
        keys.projects(),
        keys.triage(workspace, project),
      ),
  })
}

/**
 * Approve or reject a build's changes. Afterwards everything that shows the build's state is
 * refetched: its page, the project's builds list and the projects overview.
 */
export function useReviewBuild(workspace: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'review the build' },
    mutationFn: ({ state, reason }: Decision) =>
      post<Review.Decided>(
        projectPath(workspace, project, 'builds', number, 'review'),
        reason ? { state, reason } : { state },
      ),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.build(workspace, project, number),
        keys.project(workspace, project),
        keys.projects(),
      ),
  })
}
