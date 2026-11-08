import type { Sidebar, View } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '#lib/http.ts'

export const viewsQuery = (org: string) =>
  queryOptions({
    queryKey: ['views', org],
    queryFn: () => getJson<View.List>(`/api/orgs/${seg(org)}/views`),
  })

/** The view with `id` in a list of the person's views. */
export const findView = (views: readonly View.Item[] | undefined, id: string) =>
  views?.find((v) => v.id === id)

/** Saves the filters of a project's builds list as a view; pinned, so it shows under "Your views" at once. */
export function useSaveView(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; project: string; filters: View.Filters }) =>
      post<View.Item>(`/api/orgs/${seg(org)}/views`, { ...input, pinned: true }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sidebar', org] }),
        queryClient.invalidateQueries({ queryKey: ['views', org] }),
      ]),
  })
}

/** Pins or unpins a project in the sidebar. */
export function usePinProject(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pinned: boolean) =>
      send<Sidebar.PinResult>(
        pinned ? 'PUT' : 'DELETE',
        `/api/orgs/${seg(org)}/pinned-projects/${seg(project)}`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sidebar', org] }),
  })
}
