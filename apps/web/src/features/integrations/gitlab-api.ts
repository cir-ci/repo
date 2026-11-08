import type { Integration } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg, send } from '#lib/http.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------

/** Whether the text (padding ignored) is an http(s) address, as GitLab's address must be. */
export function isGitlabBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** A GitLab project path with its namespace: `acme/web`, `acme/tools/web`. */
export const isGitlabProjectPath = (value: string) => /^[\w.-]+(\/[\w.-]+)+$/.test(value.trim())

// ---- Server state -----------------------------------------------------------------------------

const base = (org: string) => `/api/orgs/${seg(org)}/integrations`

export const gitlabPageQuery = (org: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'gitlab'],
    queryFn: () => getJson<Integration.GitlabPage>(`${base(org)}/gitlab`),
  })

export function useConnectGitlab(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { baseUrl: string; token: string }) =>
      post<{ id: string }>(`${base(org)}/gitlab`, {
        baseUrl: input.baseUrl.trim(),
        token: input.token.trim(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}

/** Points a project at a GitLab project on a GitLab connection, or stops it. */
export function useGitlabProjectRepository(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations', org] })
  const url = (project: string) => `${base(org)}/gitlab/projects/${seg(project)}`
  return {
    link: useMutation({
      mutationFn: (input: { project: string; repoRef: string; connectionId: string }) =>
        send<unknown>('PUT', url(input.project), {
          repoRef: input.repoRef.trim(),
          connectionId: input.connectionId,
        }),
      onSuccess: refresh,
    }),
    unlink: useMutation({
      mutationFn: (project: string) => send<undefined>('DELETE', url(project)),
      onSuccess: refresh,
    }),
  }
}
