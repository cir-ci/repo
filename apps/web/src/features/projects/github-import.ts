import type { Workspace } from '@circi/api'

/** The Import from GitHub dialog without a DOM: which repositories a search leaves, and what the button says. */

export type Repository = Workspace.GithubRepositories['repositories'][number]

/** One repository of one installation: the same `owner/name` may be seen by two. */
export const repositoryKey = (r: Pick<Repository, 'integration' | 'ref'>) =>
  `${r.integration}/${r.ref}`

/** The repositories whose name holds every word typed; all of them for an empty search. */
export function filterRepositories(
  repositories: readonly Repository[],
  search: string,
): Repository[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return repositories.filter((r) => words.every((w) => r.ref.toLowerCase().includes(w)))
}

/** The submit button: "Import 3 projects", or just "Import" while nothing is picked. */
export const importLabel = (count: number): string =>
  count === 0 ? 'Import' : `Import ${count} ${count === 1 ? 'project' : 'projects'}`
