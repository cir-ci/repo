import type { Flaky, Org, Project } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '../../lib/http.ts'
import { isActive } from '../builds/api.ts'
import { type BuildFilters, hasFilters, toQuery, toSearch } from './builds-filters.ts'

/** Page size of the builds list (the server returns at most this many). */
export const BUILDS_PAGE_SIZE = 50

export const projectsQuery = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: () => getJson<{ projects: Project.Overview[] }>('/api/projects'),
  })

export const projectQuery = (
  org: string,
  project: string,
  before?: number,
  filters: BuildFilters = {},
) =>
  queryOptions({
    // Each page and each set of filters is cached on its own.
    queryKey: [
      'project',
      org,
      project,
      before ?? null,
      ...(hasFilters(filters) ? [toSearch(filters)] : []),
    ],
    queryFn: () =>
      getJson<Project.BuildsResponse>(
        `/api/projects/${seg(org)}/${seg(project)}${toQuery(filters, before)}`,
      ),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => isActive(b.status)) ? 3_000 : false),
  })

export const capabilitiesQuery = () =>
  queryOptions({
    queryKey: ['capabilities'],
    queryFn: () => getJson<Org.Capabilities>('/api/capabilities'),
  })

export function useCreateOrganization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      post<{ organization: { slug: string; name: string } }>('/api/organizations', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['capabilities'] }),
  })
}

/** Creates a project; the response holds its CI token, which is shown only once. */
export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { org: string; name: string }) =>
      post<{ project: { slug: string; name: string }; token: string }>(
        `/api/organizations/${seg(input.org)}/projects`,
        { name: input.name },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export const settingsQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: ['settings', org, project],
    queryFn: () =>
      getJson<Project.SettingsResponse>(`/api/projects/${seg(org)}/${seg(project)}/settings`),
  })

/** Saves some project settings, then refreshes everything that shows them. */
export function useSaveSettings(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Project.Settings>) =>
      send<{ settings: Project.Settings }>(
        'PATCH',
        `/api/projects/${seg(org)}/${seg(project)}/settings`,
        patch,
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', org, project] }),
        queryClient.invalidateQueries({ queryKey: ['project', org, project] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  })
}

export function useAddWebhook(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { url: string; events: string[] }) =>
      post<{ webhook: Project.Webhook; secret: string }>(
        `/api/projects/${seg(org)}/${seg(project)}/webhooks`,
        input,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', org, project] }),
  })
}

export function useDeleteWebhook(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>('DELETE', `/api/projects/${seg(org)}/${seg(project)}/webhooks/${seg(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', org, project] }),
  })
}

export function useRotateToken(org: string, project: string) {
  return useMutation({
    mutationFn: () =>
      post<{ token: string }>(`/api/projects/${seg(org)}/${seg(project)}/token`, {}),
  })
}

export const flakyQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: ['flaky', org, project],
    queryFn: () => getJson<Flaky.Report>(`/api/projects/${seg(org)}/${seg(project)}/flaky`),
    staleTime: 60_000,
  })

/** Approves or rejects several builds of a project in one request (all or nothing). */
export function useBulkReview(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      buildIds: string[]
      decision: 'approved' | 'rejected'
      reason?: string
    }) => post(`/api/projects/${seg(org)}/${seg(project)}/builds/review`, input),
    onSuccess: () =>
      Promise.all(
        [['project', org, project], ['sidebar'], ['reviews'], ['inbox'], ['projects']].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}

/** Asks one person to review each of several builds (one request per build; there is no bulk route). */
export function useBulkRequestReview(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { numbers: number[]; reviewerId: string }) =>
      Promise.all(
        input.numbers.map((n) =>
          post(`/api/projects/${seg(org)}/${seg(project)}/builds/${n}/review-requests`, {
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
