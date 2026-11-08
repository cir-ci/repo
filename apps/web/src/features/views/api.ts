import type { Sidebar, View } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '#lib/http.ts'

export const viewsQuery = (workspace: string) =>
  queryOptions({
    queryKey: ['views', workspace],
    queryFn: () => getJson<View.List>(`/api/workspaces/${seg(workspace)}/views`),
  })

/** The view with `id` in a list of the person's views. */
export const findView = (views: readonly View.Item[] | undefined, id: string) =>
  views?.find((v) => v.id === id)

/** Saves the filters of a team's builds list as a view; pinned, so it shows under "Your views" at once. */
export function useSaveView(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; team: string; filters: View.Filters }) =>
      post<View.Item>(`/api/workspaces/${seg(workspace)}/views`, { ...input, pinned: true }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sidebar', workspace] }),
        queryClient.invalidateQueries({ queryKey: ['views', workspace] }),
      ]),
  })
}

/** Pins or unpins a team in the sidebar. */
export function usePinTeam(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pinned: boolean) =>
      send<Sidebar.PinResult>(
        pinned ? 'PUT' : 'DELETE',
        `/api/workspaces/${seg(workspace)}/pinned-teams/${seg(team)}`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sidebar', workspace] }),
  })
}
