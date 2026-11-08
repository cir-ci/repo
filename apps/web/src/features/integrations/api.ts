import type { Integration } from '@circi/api'
import {
  filterCatalog,
  INTEGRATION_GROUP_LABEL,
  INTEGRATION_GROUPS,
  isInstallationId,
} from '@circi/core/integrations'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg, send } from '#lib/http.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------

export type GroupFilter = Integration.Group | 'all'

export const GROUPS: readonly { value: Integration.Group; label: string }[] =
  INTEGRATION_GROUPS.map((value) => ({ value, label: INTEGRATION_GROUP_LABEL[value] }))

/** The added integrations under their group headings, in the canvas order; empty groups left out. */
export function groupItems(
  items: readonly Integration.Item[],
): { group: Integration.Group; label: string; items: Integration.Item[] }[] {
  return GROUPS.flatMap(({ value, label }) => {
    const inGroup = items.filter((i) => i.group === value)
    return inGroup.length > 0 ? [{ group: value, label, items: inGroup }] : []
  })
}

export const isGroupFilter = (value: string): value is GroupFilter =>
  value === 'all' || GROUPS.some((g) => g.value === value)

export { filterCatalog, isInstallationId }

/** What a tile says when it can't be picked, or null when it can. */
export function unavailableNote(entry: Integration.CatalogEntry): string | null {
  if (entry.status === 'planned') return 'Planned'
  if (!entry.built) return 'Coming soon'
  if (!entry.connectable) return 'Not set up on this server'
  return null
}

/**
 * How an added integration is named in labels and titles: the provider's display name, then the
 * account it is connected to ("GitHub (Installation 501)", "Slack (Acme Slack)").
 */
export const integrationLabel = (item: Pick<Integration.Item, 'kindName' | 'name'>) =>
  `${item.kindName} (${item.name})`

/** Where a `custom` integration's own page is, if it has one yet (generic ones share a page). */
export const integrationPage = (kind: string): 'github' | 'gitlab' | 'bitbucket' | null =>
  kind === 'github' || kind === 'gitlab' || kind === 'bitbucket' ? kind : null

/** "3 projects", "1 project", "No projects yet". */
export const projectCountLabel = (count: number) =>
  count === 0 ? 'No projects yet' : `${count} ${count === 1 ? 'project' : 'projects'}`

// ---- Server state -----------------------------------------------------------------------------

const base = (org: string) => `/api/orgs/${seg(org)}/integrations`

export const integrationsQuery = (org: string) =>
  queryOptions({
    queryKey: ['integrations', org],
    queryFn: () => getJson<Integration.ListResponse>(base(org)),
  })

export const githubPageQuery = (org: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'github'],
    queryFn: () => getJson<Integration.GithubPage>(`${base(org)}/github`),
  })

export const repositoriesQuery = (org: string, connectionId: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'repositories', connectionId],
    queryFn: () =>
      getJson<{ repositories: Integration.Repository[] }>(
        `${base(org)}/${seg(connectionId)}/repositories`,
      ),
    staleTime: 60_000,
    retry: false,
  })

export function useRemoveIntegration(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (item: Pick<Integration.Item, 'source' | 'id'>) =>
      send<undefined>('DELETE', `${base(org)}/${item.source}/${seg(item.id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}

export function useConnectGithub(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (installationId: string) =>
      post<{ id: string }>(`${base(org)}/github`, { installationId: installationId.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}

/** Points a project at a repository on an installation, or stops it (the project-level API is unchanged). */
export function useProjectRepository(org: string) {
  const queryClient = useQueryClient()
  const refresh = (project: string) => {
    void queryClient.invalidateQueries({ queryKey: ['integrations', org] })
    void queryClient.invalidateQueries({ queryKey: ['settings', org, project] })
  }
  const url = (project: string) => `/api/projects/${seg(org)}/${seg(project)}/github`
  return {
    link: useMutation({
      mutationFn: (input: { project: string; repoRef: string; installationId: string }) =>
        send<unknown>('PUT', url(input.project), {
          repoRef: input.repoRef.trim(),
          installationId: input.installationId,
        }),
      onSuccess: (_data, input) => refresh(input.project),
    }),
    unlink: useMutation({
      mutationFn: (project: string) => send<undefined>('DELETE', url(project)),
      onSuccess: (_data, project) => refresh(project),
    }),
  }
}

// ---- Bitbucket --------------------------------------------------------------------------------

/** A Bitbucket workspace id: lowercase letters, digits, dashes and underscores (`bitbucket.org/<id>`). */
export const isBitbucketWorkspace = (value: string) =>
  /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(value.trim())

export const bitbucketPageQuery = (org: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'bitbucket'],
    queryFn: () => getJson<Integration.BitbucketPage>(`${base(org)}/bitbucket`),
  })

export function useConnectBitbucket(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { workspace: string; token: string; username?: string }) =>
      post<{ id: string }>(`${base(org)}/bitbucket`, {
        workspace: input.workspace.trim(),
        token: input.token.trim(),
        ...(input.username?.trim() ? { username: input.username.trim() } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}

/** Points a project at a repository on a Bitbucket connection, or stops it. */
export function useBitbucketProjectRepository(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations', org] })
  const url = (project: string) => `${base(org)}/bitbucket/projects/${seg(project)}`
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
