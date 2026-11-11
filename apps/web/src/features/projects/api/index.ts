import type { Flaky, IgnoreRegion, Review, Workspace, WorkspaceBuilds, Project } from '@circi/api'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { isActive } from '#features/builds/api/index.ts'
import {
  type BuildFilters,
  hasFilters,
  toQuery,
  toSearch,
  toWorkspaceQuery,
} from '#features/builds/list/builds-filters.ts'
import type { Order } from '#features/builds/list/display-options.ts'
import { projectPath, workspacePath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** Page size of the builds list (the server returns at most this many). */
export const BUILDS_PAGE_SIZE = 50

export const projectsQuery = () =>
  queryOptions({
    queryKey: keys.projects(),
    queryFn: () => getJson<{ projects: Project.Overview[] }>('/api/projects'),
  })

export const projectQuery = (
  workspace: string,
  project: string,
  before?: number,
  filters: BuildFilters = {},
  order: Order = 'newest',
) =>
  queryOptions({
    // Each page, each set of filters and each order is cached on its own.
    queryKey: keys.project(
      workspace,
      project,
      before ?? null,
      ...(hasFilters(filters) ? [toSearch(filters)] : []),
      ...(order === 'newest' ? [] : [order]),
    ),
    queryFn: () =>
      getJson<Project.BuildsResponse>(
        `${projectPath(workspace, project)}${toQuery(filters, before, order)}`,
      ),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => isActive(b.status)) ? 3_000 : false),
  })

export const capabilitiesQuery = () =>
  queryOptions({
    queryKey: keys.capabilities(),
    queryFn: () => getJson<Workspace.Capabilities>('/api/capabilities'),
  })

/**
 * Tells the server which workspace was opened, so every device lands on it next. The cached
 * capabilities take the new value at once; a refused write (the workspace went away) refetches
 * them to see what the server says.
 */
export function useRememberWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => send<void>('PUT', workspacePath(slug, 'last-opened')),
    onMutate: (slug) =>
      queryClient.setQueryData<Workspace.Capabilities>(keys.capabilities(), (caps) =>
        caps ? { ...caps, lastWorkspace: slug } : caps,
      ),
    onError: () => queryClient.invalidateQueries({ queryKey: keys.capabilities() }),
  })
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'create the workspace' },
    mutationFn: (name: string) =>
      post<{ workspace: { slug: string; name: string } }>('/api/workspaces', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.capabilities() }),
  })
}

export const settingsQuery = (workspace: string, project: string) =>
  queryOptions({
    queryKey: keys.projectsettings(workspace, project),
    queryFn: () => getJson<Project.SettingsResponse>(projectPath(workspace, project, 'settings')),
  })

/** Saves some project settings, then refreshes everything that shows them. */
export function useSaveSettings(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'save settings' },
    mutationFn: (patch: Partial<Project.Settings>) =>
      send<{ settings: Project.Settings }>(
        'PATCH',
        projectPath(workspace, project, 'settings'),
        patch,
      ),
    onSuccess: (result) => {
      // After a rename the old address is gone: refetching its queries would only 404. The sidebar
      // and the Projects lists show projects by slug, so they refresh either way.
      if (result.settings.slug !== project) {
        return invalidateAll(queryClient, keys.projects(), keys.sidebar(workspace))
      }
      return invalidateAll(
        queryClient,
        keys.projectsettings(workspace, project),
        keys.project(workspace, project),
        keys.projects(),
        keys.sidebar(workspace),
      )
    },
  })
}

export function useAddWebhook(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'add the webhook' },
    mutationFn: (input: { url: string; events: string[] }) =>
      post<{ webhook: Project.Webhook; secret: string }>(
        projectPath(workspace, project, 'webhooks'),
        input,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.projectsettings(workspace, project) }),
  })
}

/** Queues a signed test event; it appears in the webhook's deliveries once it has run. */
export function useTestWebhook(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'send the test event' },
    mutationFn: (id: string) =>
      post<{ deliveryId: string }>(projectPath(workspace, project, 'webhooks', id, 'test'), {}),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.projectsettings(workspace, project) }),
  })
}

export function useDeleteWebhook(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'delete the webhook' },
    mutationFn: (id: string) =>
      send<undefined>('DELETE', projectPath(workspace, project, 'webhooks', id)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.projectsettings(workspace, project) }),
  })
}

export const tokenQuery = (workspace: string, project: string) =>
  queryOptions({
    queryKey: keys.token(workspace, project),
    queryFn: () => getJson<Project.Token>(projectPath(workspace, project, 'token')),
  })

/** Makes a new CI token (the old one stops working); the response carries it, once. */
export function useRotateToken(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'replace the token' },
    mutationFn: () => post<Project.TokenRotated>(projectPath(workspace, project, 'token'), {}),
    onSuccess: (rotated) => queryClient.setQueryData(keys.token(workspace, project), rotated.info),
  })
}

/** Saves the project's tile colour and icon, then refreshes everything that draws the tile. */
export function useSaveAppearance(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'save' },
    mutationFn: (patch: Partial<Project.Appearance>) =>
      send<{ appearance: Project.Appearance }>(
        'PATCH',
        projectPath(workspace, project, 'appearance'),
        patch,
      ),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.projectsettings(workspace, project),
        keys.project(workspace, project),
        keys.projects(),
        keys.sidebar(),
      ),
  })
}

/** Deletes the project; everything fetched about it or the lists it was in is refetched. */
export function useDeleteProject(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'delete the project' },
    mutationFn: () => send<void>('DELETE', projectPath(workspace, project)),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: keys.project(workspace, project) })
      queryClient.removeQueries({ queryKey: keys.projectsettings(workspace, project) })
      return invalidateAll(queryClient, keys.projects(), keys.sidebar(), keys.capabilities())
    },
  })
}

/** Unlinks the project from its git repository (linking happens in the workspace's integrations). */
export function useUnlinkRepository(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'remove the repository link' },
    mutationFn: () => send<undefined>('DELETE', projectPath(workspace, project, 'github')),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.projectsettings(workspace, project) }),
  })
}

/** `name` also lists that screenshot when it has no regions yet (the flaky banner links with it). */
export const ignoreRegionsQuery = (workspace: string, project: string, name?: string) =>
  queryOptions({
    queryKey: [...keys.ignoreRegions(workspace, project), name ?? null] as const,
    queryFn: () =>
      getJson<IgnoreRegion.List>(
        `${projectPath(workspace, project, 'ignore-regions')}${name ? `?name=${encodeURIComponent(name)}` : ''}`,
      ),
  })

export type RegionRect = Pick<IgnoreRegion.Item, 'x' | 'y' | 'width' | 'height'>

export function useAddIgnoreRegion(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'add the ignore region' },
    mutationFn: (input: RegionRect & { name: string }) =>
      post<IgnoreRegion.Item>(projectPath(workspace, project, 'ignore-regions'), input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.ignoreRegions(workspace, project) }),
  })
}

export function useEditIgnoreRegion(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'save the ignore region' },
    mutationFn: (input: { id: string; rect: RegionRect }) =>
      send<IgnoreRegion.Item>(
        'PATCH',
        projectPath(workspace, project, 'ignore-regions', input.id),
        input.rect,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.ignoreRegions(workspace, project) }),
  })
}

/**
 * Saves an ignore region moved or resized with the mouse. The list shows the new rectangle at
 * once and goes back to what it was if the save fails; the refetch afterwards settles it.
 */
export function useAdjustIgnoreRegion(workspace: string, project: string) {
  const queryClient = useQueryClient()
  const key = keys.ignoreRegions(workspace, project)
  return useMutation({
    meta: { what: 'save the ignore region' },
    mutationFn: (input: { id: string; rect: RegionRect }) =>
      send<IgnoreRegion.Item>(
        'PATCH',
        projectPath(workspace, project, 'ignore-regions', input.id),
        input.rect,
      ),
    onMutate: async (input) => {
      const before = queryClient.getQueriesData<IgnoreRegion.List>({ queryKey: key })
      queryClient.setQueriesData<IgnoreRegion.List>(
        { queryKey: key },
        (list) =>
          list && {
            ...list,
            regions: list.regions.map((r) => (r.id === input.id ? { ...r, ...input.rect } : r)),
          },
      )
      await queryClient.cancelQueries({ queryKey: key })
      return { before }
    },
    onError: (_error, _input, context) => {
      for (const [queryKey, data] of context?.before ?? []) queryClient.setQueryData(queryKey, data)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useDeleteIgnoreRegion(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'remove the ignore region' },
    mutationFn: (id: string) =>
      send<undefined>('DELETE', projectPath(workspace, project, 'ignore-regions', id)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.ignoreRegions(workspace, project) }),
  })
}

export const flakyQuery = (workspace: string, project: string) =>
  queryOptions({
    queryKey: keys.flaky(workspace, project),
    queryFn: () => getJson<Flaky.Report>(projectPath(workspace, project, 'flaky')),
    staleTime: 60_000,
  })

/** A page of the builds of every project of a workspace (a view with no project); `before` is a build id. */
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

/** The branches builds were made on, most recent first, narrowed by the typed text (a project's, or the workspace's). */
export const branchesQuery = (workspace: string, project: string | undefined, text: string) =>
  queryOptions({
    queryKey: keys.branches(workspace, project ?? null, text),
    queryFn: () =>
      getJson<WorkspaceBuilds.Branches>(
        `${workspacePath(workspace, 'builds', 'branches')}?${new URLSearchParams({ q: text, ...(project ? { project } : {}) })}`,
      ),
    staleTime: 30_000,
  })

/** Approves or rejects several builds of a project in one request (all or nothing). */
export function useBulkReview(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'review the builds' },
    mutationFn: (input: {
      buildIds: string[]
      decision: 'approved' | 'rejected'
      reason?: string
    }) => post(projectPath(workspace, project, 'builds', 'review'), input),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.project(workspace, project),
        keys.sidebar(),
        keys.reviews(),
        keys.inbox(),
        keys.projects(),
      ),
  })
}

/** Asks people to review several builds of a project in one request (all or nothing). */
export function useBulkRequestReview(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'ask for a review' },
    mutationFn: (input: { buildIds: string[]; reviewerIds: string[] }) =>
      post<Review.BulkRequested>(
        projectPath(workspace, project, 'builds', 'request-review'),
        input,
      ),
    onSuccess: () => invalidateAll(queryClient, keys.sidebar(), keys.reviews(), keys.inbox()),
  })
}

/**
 * Whether the project asks for a reason when someone rejects. True until the settings are known, so a
 * reject never goes out without one only because the answer was slow.
 */
export function useRejectReasonRequired(workspace: string, project: string): boolean {
  const { data } = useQuery({ ...settingsQuery(workspace, project), enabled: project !== '' })
  // A reply without the settings (still loading, or refused) keeps the safe answer.
  const settings: Partial<Project.Settings> | undefined = data?.settings
  return settings?.requireRejectReason ?? true
}
