import type { Flaky, IgnoreRegion, Review, Workspace, WorkspaceBuilds, Team } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { renameRememberedTeam } from '#app/shell-model.ts'
import { isActive } from '#features/builds/api/index.ts'
import {
  type BuildFilters,
  hasFilters,
  toQuery,
  toSearch,
  toWorkspaceQuery,
} from '#features/builds/list/builds-filters.ts'
import type { Order } from '#features/builds/list/display-options.ts'
import { teamPath, workspacePath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** Page size of the builds list (the server returns at most this many). */
export const BUILDS_PAGE_SIZE = 50

export const teamsQuery = () =>
  queryOptions({
    queryKey: keys.teams(),
    queryFn: () => getJson<{ teams: Team.Overview[] }>('/api/teams'),
  })

export const teamQuery = (
  workspace: string,
  team: string,
  before?: number,
  filters: BuildFilters = {},
  order: Order = 'newest',
) =>
  queryOptions({
    // Each page, each set of filters and each order is cached on its own.
    queryKey: keys.team(
      workspace,
      team,
      before ?? null,
      ...(hasFilters(filters) ? [toSearch(filters)] : []),
      ...(order === 'newest' ? [] : [order]),
    ),
    queryFn: () =>
      getJson<Team.BuildsResponse>(
        `${teamPath(workspace, team)}${toQuery(filters, before, order)}`,
      ),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => isActive(b.status)) ? 3_000 : false),
  })

export const capabilitiesQuery = () =>
  queryOptions({
    queryKey: keys.capabilities(),
    queryFn: () => getJson<Workspace.Capabilities>('/api/capabilities'),
  })

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      post<{ workspace: { slug: string; name: string } }>('/api/workspaces', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.capabilities() }),
  })
}

export const settingsQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.teamSettings(workspace, team),
    queryFn: () => getJson<Team.SettingsResponse>(teamPath(workspace, team, 'settings')),
  })

/** Saves some team settings, then refreshes everything that shows them. */
export function useSaveSettings(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Team.Settings>) =>
      send<{ settings: Team.Settings }>('PATCH', teamPath(workspace, team, 'settings'), patch),
    onSuccess: (result) => {
      // After a rename the old address is gone: refetching its queries would only 404. The sidebar
      // and the settings nav list teams by slug, so they refresh either way; the remembered
      // "last team in settings" follows the rename.
      if (result.settings.slug !== team) {
        renameRememberedTeam(workspace, team, result.settings.slug)
        return invalidateAll(queryClient, keys.teams(), keys.sidebar(workspace))
      }
      return invalidateAll(
        queryClient,
        keys.teamSettings(workspace, team),
        keys.team(workspace, team),
        keys.teams(),
        keys.sidebar(workspace),
      )
    },
  })
}

export function useAddWebhook(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { url: string; events: string[] }) =>
      post<{ webhook: Team.Webhook; secret: string }>(teamPath(workspace, team, 'webhooks'), input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.teamSettings(workspace, team) }),
  })
}

/** Queues a signed test event; it appears in the webhook's deliveries once it has run. */
export function useTestWebhook(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      post<{ deliveryId: string }>(teamPath(workspace, team, 'webhooks', id, 'test'), {}),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.teamSettings(workspace, team) }),
  })
}

export function useDeleteWebhook(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>('DELETE', teamPath(workspace, team, 'webhooks', id)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.teamSettings(workspace, team) }),
  })
}

export const tokenQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.token(workspace, team),
    queryFn: () => getJson<Team.Token>(teamPath(workspace, team, 'token')),
  })

/** Makes a new CI token (the old one stops working); the response carries it, once. */
export function useRotateToken(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => post<Team.TokenRotated>(teamPath(workspace, team, 'token'), {}),
    onSuccess: (rotated) => queryClient.setQueryData(keys.token(workspace, team), rotated.info),
  })
}

/** Saves the team's tile colour and icon, then refreshes everything that draws the tile. */
export function useSaveAppearance(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Team.Appearance>) =>
      send<{ appearance: Team.Appearance }>(
        'PATCH',
        teamPath(workspace, team, 'appearance'),
        patch,
      ),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.teamSettings(workspace, team),
        keys.team(workspace, team),
        keys.teams(),
        keys.sidebar(),
      ),
  })
}

/** Deletes the team; everything fetched about it or the lists it was in is refetched. */
export function useDeleteTeam(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => send<void>('DELETE', teamPath(workspace, team)),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: keys.team(workspace, team) })
      queryClient.removeQueries({ queryKey: keys.teamSettings(workspace, team) })
      return invalidateAll(queryClient, keys.teams(), keys.sidebar(), keys.capabilities())
    },
  })
}

/** Unlinks the team from its git repository (linking happens in the workspace's integrations). */
export function useUnlinkRepository(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => send<undefined>('DELETE', teamPath(workspace, team, 'github')),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.teamSettings(workspace, team) }),
  })
}

export const ignoreRegionsQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.ignoreRegions(workspace, team),
    queryFn: () => getJson<IgnoreRegion.List>(teamPath(workspace, team, 'ignore-regions')),
  })

export type RegionRect = Pick<IgnoreRegion.Item, 'x' | 'y' | 'width' | 'height'>

export function useAddIgnoreRegion(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RegionRect & { name: string }) =>
      post<IgnoreRegion.Item>(teamPath(workspace, team, 'ignore-regions'), input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.ignoreRegions(workspace, team) }),
  })
}

export function useEditIgnoreRegion(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; rect: RegionRect }) =>
      send<IgnoreRegion.Item>(
        'PATCH',
        teamPath(workspace, team, 'ignore-regions', input.id),
        input.rect,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.ignoreRegions(workspace, team) }),
  })
}

export function useDeleteIgnoreRegion(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>('DELETE', teamPath(workspace, team, 'ignore-regions', id)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.ignoreRegions(workspace, team) }),
  })
}

export const flakyQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.flaky(workspace, team),
    queryFn: () => getJson<Flaky.Report>(teamPath(workspace, team, 'flaky')),
    staleTime: 60_000,
  })

/** A page of the builds of every team of a workspace (a view with no team); `before` is a build id. */
export const workspaceBuildsQuery = (
  workspace: string,
  before?: string,
  filters: BuildFilters = {},
  order: Order = 'newest',
) =>
  queryOptions({
    queryKey: keys.workspaceBuilds(
      workspace,
      before ?? null,
      ...(hasFilters(filters) ? [toSearch(filters)] : []),
      ...(order === 'newest' ? [] : [order]),
    ),
    queryFn: () =>
      getJson<WorkspaceBuilds.List>(
        `${workspacePath(workspace, 'builds')}${toWorkspaceQuery(filters, before, order)}`,
      ),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => isActive(b.status)) ? 3_000 : false),
  })

/** People to offer while typing an author or reviewer filter. */
export const suggestionsQuery = (workspace: string, field: 'author' | 'reviewer', text: string) =>
  queryOptions({
    queryKey: keys.buildSuggestions(workspace, field, text),
    queryFn: () =>
      getJson<WorkspaceBuilds.Suggestions>(
        `${workspacePath(workspace, 'builds', 'suggestions')}?${new URLSearchParams({ field, q: text })}`,
      ),
    staleTime: 30_000,
  })

/** The branches builds were made on, most recent first, narrowed by the typed text (a team's, or the workspace's). */
export const branchesQuery = (workspace: string, team: string | undefined, text: string) =>
  queryOptions({
    queryKey: keys.branches(workspace, team ?? null, text),
    queryFn: () =>
      getJson<WorkspaceBuilds.Branches>(
        `${workspacePath(workspace, 'builds', 'branches')}?${new URLSearchParams({ q: text, ...(team ? { team } : {}) })}`,
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
    }) => post(teamPath(workspace, team, 'builds', 'review'), input),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.team(workspace, team),
        keys.sidebar(),
        keys.reviews(),
        keys.inbox(),
        keys.teams(),
      ),
  })
}

/** Asks people to review several builds of a team in one request (all or nothing). */
export function useBulkRequestReview(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { buildIds: string[]; reviewerIds: string[] }) =>
      post<Review.BulkRequested>(teamPath(workspace, team, 'builds', 'request-review'), input),
    onSuccess: () => invalidateAll(queryClient, keys.sidebar(), keys.reviews(), keys.inbox()),
  })
}
