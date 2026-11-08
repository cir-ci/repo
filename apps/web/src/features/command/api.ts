import type { Search } from '@circi/api'
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { request, seg } from '#lib/http.ts'

/** How long typing pauses before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 200

/** The search route. React Query hands over an abort signal and fires it when the query is no longer wanted, so a stale request is dropped. */
export const searchQuery = (workspace: string, q: string) =>
  queryOptions({
    queryKey: ['search', workspace, q],
    queryFn: ({ signal }) =>
      request<Search.Results>(
        `/api/workspaces/${seg(workspace)}/search?q=${encodeURIComponent(q)}`,
        {
          signal,
        },
      ),
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

/** The results for what has been typed (debounced); the previous ones stay while the next load. */
export function useSearchResults(workspace: string | undefined, query: string) {
  const q = useDebounced(query)
  const active = workspace !== undefined && q !== ''
  const result = useQuery({
    ...searchQuery(workspace ?? '', q),
    enabled: active,
    placeholderData: keepPreviousData,
  })
  return {
    results: active ? result.data : undefined,
    // True from the first keystroke until the answer for exactly this text arrives.
    pending: query !== '' && (q !== query || (active && result.isFetching)),
    failed: active && result.isError,
  }
}
