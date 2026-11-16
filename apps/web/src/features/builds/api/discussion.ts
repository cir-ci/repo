import type { Activity, Comment, Review } from '@circi/api'
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {
  pendingComment,
  withComment,
  withDeletedComment,
  withEditedComment,
} from '#features/builds/api/comments-optimistic.ts'
import { buildQuery } from '#features/builds/api/index.ts'
import { projectMembersQuery } from '#features/projects/api/members.ts'
import { projectPath } from '#lib/api-paths.ts'
import { authClient } from '#lib/auth-client.ts'
import { getJson, post, send } from '#lib/http.ts'
import type { Mention } from '#lib/mentions.ts'
import { applyPatches, patchOf, rollback } from '#lib/optimistic.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** The project's members as @mention candidates (empty while they load). */
export function useMentionMembers(workspace: string, project: string): Mention.Member[] {
  const { data } = useQuery(projectMembersQuery(workspace, project))
  return (data?.members ?? []).map((m) => ({
    userId: m.id,
    name: m.name,
    email: m.email,
    image: m.image,
  }))
}

export const commentsQuery = (workspace: string, project: string, number: number) =>
  queryOptions({
    queryKey: keys.comments(workspace, project, number),
    queryFn: () =>
      getJson<Comment.List>(projectPath(workspace, project, 'builds', number, 'comments')),
  })

export const activityQuery = (workspace: string, project: string, number: number) =>
  queryOptions({
    queryKey: keys.activity(workspace, project, number),
    queryFn: () =>
      getJson<Activity.Timeline>(projectPath(workspace, project, 'builds', number, 'activity')),
  })

/** A comment changes the thread list, and shows up in the build's activity. */
function useRefreshDiscussion(workspace: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return () =>
    invalidateAll(
      queryClient,
      keys.comments(workspace, project, number),
      keys.activity(workspace, project, number),
    )
}

/**
 * The thread list and the activity are refetched when a comment change settles; until then the
 * list shows the change (`patch`) and goes back if the server says no.
 */
function useCommentMutation<V, R>(
  workspace: string,
  project: string,
  number: number,
  what: string,
  mutationFn: (vars: V) => Promise<R>,
  patch: (list: Comment.List, vars: V) => Comment.List,
) {
  const queryClient = useQueryClient()
  const refresh = useRefreshDiscussion(workspace, project, number)
  return useMutation({
    meta: { what },
    mutationFn,
    onMutate: (vars: V) =>
      applyPatches(queryClient, [
        patchOf<Comment.List>(keys.comments(workspace, project, number), (list) =>
          patch(list, vars),
        ),
      ]),
    onError: (_error, _vars, snapshot) => rollback(queryClient, snapshot),
    onSettled: refresh,
  })
}

let pendingCount = 0

export function useAddComment(workspace: string, project: string, number: number) {
  const { data: session } = authClient.useSession()
  const author = session
    ? { id: session.user.id, name: session.user.name, image: session.user.image ?? null }
    : null
  return useCommentMutation(
    workspace,
    project,
    number,
    'add the comment',
    (input: Comment.Create) =>
      post<{ id: string }>(projectPath(workspace, project, 'builds', number, 'comments'), input),
    (list, input) =>
      withComment(list, pendingComment(input, author, `pending-${++pendingCount}`, new Date())),
  )
}

export function useEditComment(workspace: string, project: string, number: number) {
  return useCommentMutation(
    workspace,
    project,
    number,
    'edit the comment',
    ({ id, body }: { id: string } & Comment.Edit) =>
      send<{ id: string }>(
        'PATCH',
        projectPath(workspace, project, 'builds', number, 'comments', id),
        { body },
      ),
    (list, { id, body }) => withEditedComment(list, id, body, new Date()),
  )
}

/**
 * Saves a comment's region moved or resized with the mouse (its author only). The comment shows
 * the new region at once and goes back to the old one if the save fails.
 */
export function useSetCommentRegion(workspace: string, project: string, number: number) {
  const queryClient = useQueryClient()
  const key = keys.comments(workspace, project, number)
  return useMutation({
    meta: { what: 'save the region' },
    mutationFn: ({ id, region }: { id: string; region: Comment.SetRegion }) =>
      send<Comment.Item>(
        'PATCH',
        projectPath(workspace, project, 'builds', number, 'comments', id, 'region'),
        region,
      ),
    onMutate: async ({ id, region }) => {
      const before = queryClient.getQueryData<Comment.List>(key)
      queryClient.setQueryData<Comment.List>(
        key,
        (list) =>
          list && { comments: list.comments.map((c) => (c.id === id ? { ...c, region } : c)) },
      )
      await queryClient.cancelQueries({ queryKey: key })
      return { before }
    },
    onError: (_error, _input, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useDeleteComment(workspace: string, project: string, number: number) {
  return useCommentMutation(
    workspace,
    project,
    number,
    'delete the comment',
    (id: string) =>
      send<undefined>('DELETE', projectPath(workspace, project, 'builds', number, 'comments', id)),
    (list, id) => withDeletedComment(list, id, new Date()),
  )
}

/**
 * Asks one workspace member to review a build. It goes through the bulk endpoint, whose answer
 * carries the token that takes the request back (the toast's Undo).
 */
export async function askForReview(
  queryClient: QueryClient,
  subject: { workspace: string; project: string; number: number },
  reviewerId: string,
): Promise<Review.BulkRequested> {
  const { build } = await queryClient.fetchQuery(
    buildQuery(subject.workspace, subject.project, subject.number),
  )
  return post<Review.BulkRequested>(
    projectPath(subject.workspace, subject.project, 'builds', 'request-review'),
    { buildIds: [build.id], reviewerIds: [reviewerId] },
  )
}

/** Asks a workspace member to review the build; the activity shows the request. */
export function useRequestReview(workspace: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'ask for a review' },
    mutationFn: (reviewerId: string) =>
      askForReview(queryClient, { workspace, project, number }, reviewerId),
    onSuccess: () =>
      invalidateAll(queryClient, keys.activity(workspace, project, number), keys.reviews()),
  })
}
