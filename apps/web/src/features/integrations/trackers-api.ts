import type { Issue } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg, send } from '#lib/http.ts'

/** Linear and Jira: the issue trackers a project can file issues in. */
export type TrackerKind = 'linear' | 'jira'

export const TRACKER_NAME: Record<TrackerKind, string> = { linear: 'Linear', jira: 'Jira' }

/** What the mapping page calls the thing a project's issues go to. */
export const TARGET_NOUN: Record<TrackerKind, string> = { linear: 'team', jira: 'project' }

export const isTrackerKind = (kind: string): kind is TrackerKind =>
  kind === 'linear' || kind === 'jira'

/** Whether the text looks like a Jira Cloud address: a host name with a dot, with or without `https://`. */
export function isJiraSite(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  try {
    const host = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname
    return host.includes('.') && !/^[\d.]+$/.test(host)
  } catch {
    return false
  }
}

const base = (org: string) => `/api/orgs/${seg(org)}/integrations`

export const trackerPageQuery = (org: string, kind: TrackerKind) =>
  queryOptions({
    queryKey: ['integrations', org, kind],
    queryFn: () => getJson<Issue.Page>(`${base(org)}/${kind}`),
  })

export const targetsQuery = (org: string, connectionId: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'targets', connectionId],
    queryFn: () =>
      getJson<{ targets: Issue.Target[] }>(`${base(org)}/${seg(connectionId)}/targets`),
    staleTime: 60_000,
    retry: false,
  })

export function useConnectLinear(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Issue.ConnectLinear) =>
      post<{ id: string }>(`${base(org)}/linear`, { apiKey: input.apiKey.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}

export function useConnectJira(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Issue.ConnectJira) =>
      post<{ id: string }>(`${base(org)}/jira`, {
        siteUrl: input.siteUrl.trim(),
        email: input.email.trim(),
        apiToken: input.apiToken.trim(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}

/** Files a project's issues in a team or project of a connection, or stops. */
export function useTrackerMapping(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations', org] })
  const url = (connectionId: string, project: string) =>
    `${base(org)}/${seg(connectionId)}/projects/${seg(project)}`
  return {
    set: useMutation({
      mutationFn: (input: { connectionId: string; project: string; target: string }) =>
        send<undefined>('PUT', url(input.connectionId, input.project), { target: input.target }),
      onSuccess: refresh,
    }),
    clear: useMutation({
      mutationFn: (input: { connectionId: string; project: string }) =>
        send<undefined>('DELETE', url(input.connectionId, input.project)),
      onSuccess: refresh,
    }),
  }
}
