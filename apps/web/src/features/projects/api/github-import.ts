import type { Workspace } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { workspacePath } from '#lib/api-paths.ts'
import { getJson, post } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** The repositories of the workspace's GitHub installations that no project is linked to yet. */
export const githubImportQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.githubImport(workspace),
    queryFn: () => getJson<Workspace.GithubRepositories>(workspacePath(workspace, 'github-import')),
    // A fresh list each time the dialog opens: repositories come and go on GitHub.
    staleTime: 0,
  })

/** One project per picked repository, made in one call that creates all of them or none. */
export function useImportRepositories(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'import the repositories' },
    mutationFn: (repositories: { integration: string; ref: string }[]) =>
      post<Workspace.GithubImport>(workspacePath(workspace, 'github-import'), { repositories }),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.projects(),
        keys.sidebar(),
        keys.capabilities(),
        keys.githubImport(workspace),
        keys.integrations(workspace),
      ),
  })
}
