import type { QueryClient, QueryKey } from '@tanstack/react-query'

/** One cached query family changed ahead of the server; make one with `patchOf`. */
export interface CachePatch {
  key: QueryKey
  /** Applies the change to every loaded entry under `key`; returns what each held before. */
  run: (queryClient: QueryClient) => [QueryKey, unknown][]
}

/** What was cached before the patches, to put back if the server says no. */
export interface Snapshot {
  entries: [QueryKey, unknown][]
}

/** A change to the data cached under `key` (`T` is its shape); entries not loaded yet are left alone. */
export function patchOf<T>(key: QueryKey, patch: (data: T) => T): CachePatch {
  return {
    key,
    run: (queryClient) => {
      const before: [QueryKey, unknown][] = []
      for (const [entryKey, data] of queryClient.getQueriesData<T>({ queryKey: key })) {
        if (data === undefined) continue
        before.push([entryKey, data])
        queryClient.setQueryData<T>(entryKey, patch(data))
      }
      return before
    },
  }
}

/**
 * The first half of an optimistic update (`onMutate`): cancels the in-flight fetches of each key,
 * so a slow answer can't overwrite the change, applies the patches and remembers what was cached.
 * Pass the result to `rollback` in `onError`; the caller invalidates in `onSettled`.
 */
export async function applyPatches(
  queryClient: QueryClient,
  patches: readonly CachePatch[],
): Promise<Snapshot> {
  await Promise.all(patches.map((p) => queryClient.cancelQueries({ queryKey: p.key })))
  return { entries: patches.flatMap((p) => p.run(queryClient)) }
}

/** Puts the cache back as `applyPatches` found it (the first remembered value of an entry wins). */
export function rollback(queryClient: QueryClient, snapshot: Snapshot | undefined) {
  if (!snapshot) return
  const seen = new Set<string>()
  for (const [key, data] of snapshot.entries) {
    const id = JSON.stringify(key)
    if (seen.has(id)) continue
    seen.add(id)
    queryClient.setQueryData(key, data)
  }
}
