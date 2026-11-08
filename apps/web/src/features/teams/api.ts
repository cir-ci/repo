import type { Flaky, IgnoreRegion, Review, Workspace, WorkspaceBuilds, Team } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { isActive } from '#features/builds/api.ts'
import { getJson, post, send, seg } from '#lib/http.ts'

import {
  type BuildFilters,
  hasFilters,
  toQuery,
  toSearch,
  toWorkspaceQuery,
} from './builds-filters.ts'

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

/** Queues a signed test event; it appears in the webhook's deliveries once it has run. */
export function useTestWebhook(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      post<{ deliveryId: string }>(
        `/api/teams/${seg(workspace)}/${seg(team)}/webhooks/${seg(id)}/test`,
        {},
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

export const tokenQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: ['token', workspace, team],
    queryFn: () => getJson<Team.Token>(`/api/teams/${seg(workspace)}/${seg(team)}/token`),
  })

/** Makes a new CI token (the old one stops working); the response carries it, once. */
export function useRotateToken(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      post<Team.TokenRotated>(`/api/teams/${seg(workspace)}/${seg(team)}/token`, {}),
    onSuccess: (rotated) => queryClient.setQueryData(['token', workspace, team], rotated.info),
  })
}

/** Saves the team's tile colour and icon, then refreshes everything that draws the tile. */
export function useSaveAppearance(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Team.Appearance>) =>
      send<{ appearance: Team.Appearance }>(
        'PATCH',
        `/api/teams/${seg(workspace)}/${seg(team)}/appearance`,
        patch,
      ),
    onSuccess: () =>
      Promise.all(
        [['settings', workspace, team], ['team', workspace, team], ['teams'], ['sidebar']].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}

/** Deletes the team; everything fetched about it or the lists it was in is refetched. */
export function useDeleteTeam(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => send<void>('DELETE', `/api/teams/${seg(workspace)}/${seg(team)}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['team', workspace, team] })
      queryClient.removeQueries({ queryKey: ['settings', workspace, team] })
      return Promise.all(
        [['teams'], ['sidebar'], ['capabilities']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
    },
  })
}

/** Unlinks the team from its git repository (linking happens in the workspace's integrations). */
export function useUnlinkRepository(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => send<undefined>('DELETE', `/api/teams/${seg(workspace)}/${seg(team)}/github`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', workspace, team] }),
  })
}

export const ignoreRegionsQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: ['ignore-regions', workspace, team],
    queryFn: () =>
      getJson<IgnoreRegion.List>(`/api/teams/${seg(workspace)}/${seg(team)}/ignore-regions`),
  })

export type RegionRect = Pick<IgnoreRegion.Item, 'x' | 'y' | 'width' | 'height'>

export function useAddIgnoreRegion(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RegionRect & { name: string }) =>
      post<IgnoreRegion.Item>(`/api/teams/${seg(workspace)}/${seg(team)}/ignore-regions`, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['ignore-regions', workspace, team] }),
  })
}

export function useEditIgnoreRegion(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; rect: RegionRect }) =>
      send<IgnoreRegion.Item>(
        'PATCH',
        `/api/teams/${seg(workspace)}/${seg(team)}/ignore-regions/${seg(input.id)}`,
        input.rect,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['ignore-regions', workspace, team] }),
  })
}

export function useDeleteIgnoreRegion(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>(
        'DELETE',
        `/api/teams/${seg(workspace)}/${seg(team)}/ignore-regions/${seg(id)}`,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['ignore-regions', workspace, team] }),
  })
}

export const flakyQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: ['flaky', workspace, team],
    queryFn: () => getJson<Flaky.Report>(`/api/teams/${seg(workspace)}/${seg(team)}/flaky`),
    staleTime: 60_000,
  })

/** A page of the builds of every team of a workspace (a view with no team); `before` is a build id. */
export const workspaceBuildsQuery = (
  workspace: string,
  before?: string,
  filters: BuildFilters = {},
) =>
  queryOptions({
    queryKey: [
      'workspace-builds',
      workspace,
      before ?? null,
      ...(hasFilters(filters) ? [toSearch(filters)] : []),
    ],
    queryFn: () =>
      getJson<WorkspaceBuilds.List>(
        `/api/workspaces/${seg(workspace)}/builds${toWorkspaceQuery(filters, before)}`,
      ),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => isActive(b.status)) ? 3_000 : false),
  })

/** People to offer while typing an author or reviewer filter. */
export const suggestionsQuery = (workspace: string, field: 'author' | 'reviewer', text: string) =>
  queryOptions({
    queryKey: ['build-suggestions', workspace, field, text],
    queryFn: () =>
      getJson<WorkspaceBuilds.Suggestions>(
        `/api/workspaces/${seg(workspace)}/builds/suggestions?${new URLSearchParams({ field, q: text })}`,
      ),
    staleTime: 30_000,
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

/** Asks people to review several builds of a team in one request (all or nothing). */
export function useBulkRequestReview(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { buildIds: string[]; reviewerIds: string[] }) =>
      post<Review.BulkRequested>(
        `/api/teams/${seg(workspace)}/${seg(team)}/builds/request-review`,
        input,
      ),
    onSuccess: () =>
      Promise.all(
        [['sidebar'], ['reviews'], ['inbox']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}
