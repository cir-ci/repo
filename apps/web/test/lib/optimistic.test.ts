import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { applyPatches, patchOf, rollback } from '#lib/optimistic.ts'

const noop = () => {}

describe('applyPatches and rollback', () => {
  it('patches every loaded entry under the key, leaves others alone, and rolls back', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['inbox', 'for-you'], { n: 1 })
    queryClient.setQueryData(['inbox', 'snoozed'], { n: 2 })
    queryClient.setQueryData(['other'], { n: 3 })
    const snapshot = await applyPatches(queryClient, [
      patchOf<{ n: number }>(['inbox'], (d) => ({ n: d.n + 10 })),
    ])
    expect(queryClient.getQueryData(['inbox', 'for-you'])).toEqual({ n: 11 })
    expect(queryClient.getQueryData(['inbox', 'snoozed'])).toEqual({ n: 12 })
    expect(queryClient.getQueryData(['other'])).toEqual({ n: 3 })
    rollback(queryClient, snapshot)
    expect(queryClient.getQueryData(['inbox', 'for-you'])).toEqual({ n: 1 })
    expect(queryClient.getQueryData(['inbox', 'snoozed'])).toEqual({ n: 2 })
  })

  it('restores the original when two patches change the same entry', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['a'], { n: 1 })
    const snapshot = await applyPatches(queryClient, [
      patchOf<{ n: number }>(['a'], (d) => ({ n: d.n + 1 })),
      patchOf<{ n: number }>(['a'], (d) => ({ n: d.n * 10 })),
    ])
    expect(queryClient.getQueryData(['a'])).toEqual({ n: 20 })
    rollback(queryClient, snapshot)
    expect(queryClient.getQueryData(['a'])).toEqual({ n: 1 })
  })

  it('cancels an in-flight fetch, so its late answer cannot overwrite the change', async () => {
    const queryClient = new QueryClient()
    let finish: (value: { n: number }) => void = noop
    const fetching = queryClient.fetchQuery({
      queryKey: ['slow'],
      queryFn: () => new Promise<{ n: number }>((resolve) => (finish = resolve)),
    })
    fetching.catch(() => {})
    queryClient.setQueryData(['slow'], { n: 1 })
    await applyPatches(queryClient, [patchOf<{ n: number }>(['slow'], () => ({ n: 2 }))])
    finish({ n: 99 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queryClient.getQueryData(['slow'])).toEqual({ n: 2 })
  })

  it('does nothing for entries that are not loaded or an empty snapshot', async () => {
    const queryClient = new QueryClient()
    const snapshot = await applyPatches(queryClient, [patchOf<number>(['none'], (n) => n + 1)])
    expect(snapshot.entries).toEqual([])
    expect(queryClient.getQueryData(['none'])).toBeUndefined()
    rollback(queryClient, undefined)
  })
})
