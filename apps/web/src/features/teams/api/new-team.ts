import type { Integration } from '@circi/api'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { integrationsQuery } from '#features/integrations/api.ts'
import { targetsQuery } from '#features/integrations/generic-api.ts'
import { branchToSet, type RepoChoice, repoChoices } from '#features/teams/new-team.ts'
import { post, seg } from '#lib/http.ts'

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

export interface CreateTeamInput {
  workspace: string
  name: string
  defaultBranch: string
  repo: RepoChoice | undefined
}

export interface CreatedTeam {
  workspace: string
  slug: string
  name: string
  token: string
  linked: boolean
}

/**
 * Creates a team in one call: its name, default branch (only when changed from `main`) and
 * repository go to the create route, which checks them all before anything exists, so a refusal
 * leaves no half-made team. The CI token comes back once.
 */
export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTeamInput): Promise<CreatedTeam> => {
      const branch = branchToSet(input.defaultBranch)
      const { team, token } = await post<{ team: { slug: string; name: string }; token: string }>(
        `/api/workspaces/${seg(input.workspace)}/teams`,
        {
          name: input.name,
          ...(branch ? { defaultBranch: branch } : {}),
          ...(input.repo
            ? {
                repository: {
                  integration: input.repo.integration,
                  ref: input.repo.ref,
                  name: input.repo.name,
                },
              }
            : {}),
        },
      )
      return {
        workspace: input.workspace,
        slug: team.slug,
        name: team.name,
        token,
        linked: input.repo !== undefined,
      }
    },
    onSuccess: () =>
      Promise.all(
        [['teams'], ['sidebar'], ['capabilities']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}
