import type { Flaky, Workspace, Team } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { isActive } from '#features/builds/api.ts'
import { getJson, post, send, seg } from '#lib/http.ts'

import { type BuildFilters, hasFilters, toQuery, toSearch } from './builds-filters.ts'

/** Page size of the builds list (the server returns at most this many). */
export const BUILDS_PAGE_SIZE = 50

export const teamsQuery = () =>
  queryOptions({
    queryKey: ['teams'],
    queryFn: () => getJson<{ teams: Team.Overview[] }>('/api/teams'),
  })

export const teamQuery = (
  workspace: string,
  team: string,
  before?: number,
  filters: BuildFilters = {},
) =>
  queryOptions({
    // Each page and each set of filters is cached on its own.
    queryKey: [
      'team',
      workspace,
      team,
      before ?? null,
      ...(hasFilters(filters) ? [toSearch(filters)] : []),
    ],
    queryFn: () =>
      getJson<Team.BuildsResponse>(
        `/api/teams/${seg(workspace)}/${seg(team)}${toQuery(filters, before)}`,
      ),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => isActive(b.status)) ? 3_000 : false),
  })

export const capabilitiesQuery = () =>
  queryOptions({
    queryKey: ['capabilities'],
    queryFn: () => getJson<Workspace.Capabilities>('/api/capabilities'),
  })

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      post<{ workspace: { slug: string; name: string } }>('/api/workspaces', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['capabilities'] }),
  })
}

/** Creates a team; the response holds its CI token, which is shown only once. */
export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { workspace: string; name: string }) =>
      post<{ team: { slug: string; name: string }; token: string }>(
        `/api/workspaces/${seg(input.workspace)}/teams`,
        { name: input.name },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export const settingsQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: ['settings', workspace, team],
    queryFn: () =>
      getJson<Team.SettingsResponse>(`/api/teams/${seg(workspace)}/${seg(team)}/settings`),
  })

/** Saves some team settings, then refreshes everything that shows them. */
export function useSaveSettings(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Team.Settings>) =>
      send<{ settings: Team.Settings }>(
        'PATCH',
        `/api/teams/${seg(workspace)}/${seg(team)}/settings`,
        patch,
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', workspace, team] }),
        queryClient.invalidateQueries({ queryKey: ['team', workspace, team] }),
        queryClient.invalidateQueries({ queryKey: ['teams'] }),
      ]),
  })
}

export function useAddWebhook(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { url: string; events: string[] }) =>
      post<{ webhook: Team.Webhook; secret: string }>(
        `/api/teams/${seg(workspace)}/${seg(team)}/webhooks`,
        input,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', workspace, team] }),
  })
}

export function useDeleteWebhook(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>('DELETE', `/api/teams/${seg(workspace)}/${seg(team)}/webhooks/${seg(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', workspace, team] }),
  })
}

export function useRotateToken(workspace: string, team: string) {
  return useMutation({
    mutationFn: () =>
      post<{ token: string }>(`/api/teams/${seg(workspace)}/${seg(team)}/token`, {}),
  })
}

export const flakyQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: ['flaky', workspace, team],
    queryFn: () => getJson<Flaky.Report>(`/api/teams/${seg(workspace)}/${seg(team)}/flaky`),
    staleTime: 60_000,
  })

/** Approves or rejects several builds of a team in one request (all or nothing). */
export function useBulkReview(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      buildIds: string[]
      decision: 'approved' | 'rejected'
      reason?: string
    }) => post(`/api/teams/${seg(workspace)}/${seg(team)}/builds/review`, input),
    onSuccess: () =>
      Promise.all(
        [['team', workspace, team], ['sidebar'], ['reviews'], ['inbox'], ['teams']].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}

/** Asks one person to review each of several builds (one request per build; there is no bulk route). */
export function useBulkRequestReview(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { numbers: number[]; reviewerId: string }) =>
      Promise.all(
        input.numbers.map((n) =>
          post(`/api/teams/${seg(workspace)}/${seg(team)}/builds/${n}/review-requests`, {
            reviewerId: input.reviewerId,
          }),
        ),
      ),
    onSuccess: () =>
      Promise.all(
        [['sidebar'], ['reviews'], ['inbox']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}
