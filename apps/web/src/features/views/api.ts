import type { Sidebar, View } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { sameFilters } from '#features/builds/list/builds-filters.ts'
import { workspacePath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

export const viewsQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.views(workspace),
    queryFn: () => getJson<View.List>(workspacePath(workspace, 'views')),
  })

/** The view with `id` in a list of the person's views. */
export const findView = (views: readonly View.Item[] | undefined, id: string) =>
  views?.find((v) => v.id === id)

/** The saved view of this team (or, without one, of the whole workspace) whose filters are these. */
export const viewWithFilters = (
  views: readonly View.Item[] | undefined,
  team: string | undefined,
  filters: View.Filters,
) => views?.find((v) => (v.team?.slug ?? undefined) === team && sameFilters(v.filters, filters))

/** Saves the filters of a team's builds list as a view; pinned, so it shows under "Your views" at once. */
export function useSaveView(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; team?: string | undefined; filters: View.Filters }) =>
      post<View.Item>(workspacePath(workspace, 'views'), { ...input, pinned: true }),
    onSuccess: () => invalidateAll(queryClient, keys.sidebar(workspace), keys.views(workspace)),
  })
}

/** Pins or unpins a team in the sidebar. */
export function usePinTeam(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pinned: boolean) =>
      send<Sidebar.PinResult>(
        pinned ? 'PUT' : 'DELETE',
        workspacePath(workspace, 'pinned-teams', team),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.sidebar(workspace) }),
  })
}
