import type { Integration } from '@circi/api'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { integrationsQuery } from '#features/integrations/api.ts'
import { targetsQuery } from '#features/integrations/generic-api.ts'
import { post, send, seg } from '#lib/http.ts'

import { branchToSet, type RepoChoice, repoChoices, warningText } from './new-team.ts'

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error')

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
  /** Steps that failed after the team existed (its default branch, its repository). */
  warnings: string[]
}

/**
 * Creates a team (its CI token comes back once), then applies what the create route doesn't take:
 * the default branch (a settings change) and the repository (an integration mapping). A step that
 * fails is reported and doesn't undo the team.
 */
export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTeamInput): Promise<CreatedTeam> => {
      const { team, token } = await post<{ team: { slug: string; name: string }; token: string }>(
        `/api/workspaces/${seg(input.workspace)}/teams`,
        { name: input.name },
      )
      const warnings: string[] = []
      const branch = branchToSet(input.defaultBranch)
      if (branch) {
        try {
          await send('PATCH', `/api/teams/${seg(input.workspace)}/${seg(team.slug)}/settings`, {
            defaultBranch: branch,
          })
        } catch (e) {
          warnings.push(warningText('branch', message(e)))
        }
      }
      let linked = false
      if (input.repo) {
        try {
          await send(
            'PUT',
            `/api/workspaces/${seg(input.workspace)}/integrations/${seg(input.repo.integration)}/teams/${seg(team.slug)}`,
            { ref: input.repo.ref, name: input.repo.name, extra: {} },
          )
          linked = true
        } catch (e) {
          warnings.push(warningText('repository', message(e)))
        }
      }
      return {
        workspace: input.workspace,
        slug: team.slug,
        name: team.name,
        token,
        linked,
        warnings,
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
