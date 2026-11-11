import type { Search } from '@circi/api'
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { workspacePath } from '#lib/api-paths.ts'
import { request } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

/** How long typing pauses before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 200

/** How many rows a kind returns when a chip narrows the search to it. */
export const NARROWED_LIMIT = 30

/** What narrows a search: a project (its slug), some kinds, and how many rows each. */
export interface SearchScope {
  project?: string | undefined
  kinds?: readonly Search.Kind[] | undefined
  limit?: number | undefined
}

/** The address of a search: `?q=` and, when set, `project=`, `kinds=` and `limit=`. */
export function searchUrl(workspace: string, q: string, scope: SearchScope = {}): string {
  const params = new URLSearchParams({ q })
  if (scope.project) params.set('project', scope.project)
  if (scope.kinds && scope.kinds.length > 0) params.set('kinds', scope.kinds.join(','))
  if (scope.limit !== undefined) params.set('limit', String(scope.limit))
  return `${workspacePath(workspace, 'search')}?${params.toString()}`
}

/** The search route. React Query hands over an abort signal and fires it when the query is no longer wanted, so a stale request is dropped. */
export const searchQuery = (workspace: string, q: string, scope: SearchScope = {}) =>
  queryOptions({
    queryKey: keys.search(workspace, q, {
      project: scope.project ?? null,
      kinds: scope.kinds?.join(',') ?? null,
      limit: scope.limit ?? null,
    }),
    queryFn: ({ signal }) => request<Search.Results>(searchUrl(workspace, q, scope), { signal }),
    staleTime: 30_000,
  })

/** `value`, but only once it has stayed put for `ms`. */
export function useDebounced<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * The results for what has been typed (debounced) within a scope; the previous ones stay while the
 * next load. `enabled` false (settings, the commands chip) sends nothing.
 */
export function useSearchResults(
  workspace: string | undefined,
  query: string,
  scope: SearchScope = {},
  enabled = true,
) {
  const q = useDebounced(query)
  const active = enabled && workspace !== undefined && q !== ''
  const result = useQuery({
    ...searchQuery(workspace ?? '', q, scope),
    enabled: active,
    placeholderData: keepPreviousData,
  })
  return {
    results: active ? result.data : undefined,
    // True from the first keystroke until the answer for exactly this text arrives.
    pending: enabled && query !== '' && (q !== query || (active && result.isFetching)),
    failed: active && result.isError,
    retry: () => void result.refetch(),
  }
}
