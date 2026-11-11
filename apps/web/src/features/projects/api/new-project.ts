import type { Integration } from '@circi/api'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { targetsQuery } from '#features/integrations/api/generic.ts'
import { integrationsQuery } from '#features/integrations/api/index.ts'
import { branchToSet, type RepoChoice, repoChoices } from '#features/projects/new-project.ts'
import { workspacePath } from '#lib/api-paths.ts'
import { post } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** The repositories the workspace's git integrations can see, for the Repository field. */
export function useRepoChoices(workspace: string, enabled: boolean): RepoChoice[] {
  const { data } = useQuery({
    ...integrationsQuery(workspace),
    enabled: enabled && workspace !== '',
  })
  const git = (data?.integrations ?? []).filter(
    (i: Integration.Item) => i.group === 'git' && !i.needsAttention,
  )
  const targets = useQueries({
    queries: git.map((i) => ({ ...targetsQuery(workspace, i.id), enabled })),
  })
  return repoChoices(
    git.map((i, index) => ({ id: i.id, targets: targets[index]?.data?.targets ?? [] })),
  )
}

export interface CreateProjectInput {
  workspace: string
  name: string
  defaultBranch: string
  repo: RepoChoice | undefined
  /** People to add besides you (the creator is always in). */
  memberIds?: string[]
}

export interface CreatedProject {
  workspace: string
  slug: string
  name: string
  token: string
  linked: boolean
}

/**
 * Creates a project in one call: its name, default branch (only when changed from `main`) and
 * repository go to the create route, which checks them all before anything exists, so a refusal
 * leaves no half-made project. The CI token comes back once.
 */
export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'create the project' },
    mutationFn: async (input: CreateProjectInput): Promise<CreatedProject> => {
      const branch = branchToSet(input.defaultBranch)
      const { project, token } = await post<{
        project: { slug: string; name: string }
        token: string
      }>(workspacePath(input.workspace, 'projects'), {
        name: input.name,
        ...(branch ? { defaultBranch: branch } : {}),
        ...(input.memberIds?.length ? { memberIds: input.memberIds } : {}),
        ...(input.repo
          ? {
              repository: {
                integration: input.repo.integration,
                ref: input.repo.ref,
                name: input.repo.name,
              },
            }
          : {}),
      })
      return {
        workspace: input.workspace,
        slug: project.slug,
        name: project.name,
        token,
        linked: input.repo !== undefined,
      }
    },
    onSuccess: () =>
      invalidateAll(queryClient, keys.projects(), keys.sidebar(), keys.capabilities()),
  })
}
