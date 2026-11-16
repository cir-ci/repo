import type { PersistedClient } from '@tanstack/query-persist-client-core'
import { dehydrate, QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  isExcluded,
  isPersistable,
  parsePersisted,
  PERSIST_MAX_AGE,
  pruneForStorage,
} from '#lib/persist-policy.ts'
import { keys } from '#lib/query-keys.ts'

const NOW = 1_700_000_000_000

/** A stored cache holding these queries, built by the library's own `dehydrate` (so the shape is real). */
function client(
  entries: { key: unknown[]; updatedAt?: number; data?: unknown }[],
  withMutation = false,
): PersistedClient {
  const queryClient = new QueryClient()
  for (const { key, updatedAt = NOW, data = { ok: true } } of entries) {
    queryClient.setQueryData(key, data, { updatedAt })
  }
  if (withMutation) {
    queryClient
      .getMutationCache()
      .build(queryClient, { mutationKey: ['x'], mutationFn: () => Promise.resolve() })
  }
  return {
    timestamp: NOW,
    buster: 'b1',
    clientState: dehydrate(queryClient, {
      shouldDehydrateQuery: () => true,
      shouldDehydrateMutation: () => true,
    }),
  }
}

describe('which queries are stored', () => {
  it('stores the read models and never a secret, an account page or a typed-ahead lookup', () => {
    expect(isPersistable(keys.inbox('for-you'))).toBe(true)
    expect(isPersistable(keys.build('acme', 'web', 3))).toBe(true)
    expect(isPersistable(keys.project('acme', 'web'))).toBe(true)
    for (const key of [
      keys.token('acme', 'web'),
      keys.integrations('acme'),
      keys.setup(),
      keys.sessions(),
      keys.pushDevices(),
      keys.workspaceSso('acme'),
      keys.instanceSettings(),
      keys.instanceAccounts('x'),
      keys.search('acme', 'q'),
    ]) {
      expect(isPersistable(key)).toBe(false)
      expect(isExcluded(key)).toBe(true)
    }
  })

  it('stores a key it has never heard of nowhere', () => {
    expect(isPersistable(['brand-new-thing', 1])).toBe(false)
    expect(isPersistable([])).toBe(false)
    expect(isPersistable([{ not: 'a string' }])).toBe(false)
  })

  it('makes a decision about every key in query-keys.ts, so a new query is never stored by accident', () => {
    // Each key function called with strings (a prefix key, or all arguments): its first part
    // must be named as stored or as excluded in persist-policy.ts.
    const undecided = Object.entries(keys)
      .map(([name, fn]) => {
        const key: unknown = Reflect.apply(fn, undefined, ['a', 'b', 'c', 'd'])
        return [name, Array.isArray(key) ? key : []] as const
      })
      .filter(([, key]) => !isPersistable(key) && !isExcluded(key))
      .map(([name]) => name)
    expect(undecided).toEqual([])
  })
})

describe('pruneForStorage', () => {
  it('drops excluded keys, anything past the age and every mutation', () => {
    const input = client(
      [
        { key: ['inbox', 'for-you'] },
        { key: ['token', 'acme', 'web'] },
        { key: ['build', 'acme', 'web', 1], updatedAt: NOW - PERSIST_MAX_AGE - 1 },
        { key: ['build', 'acme', 'web', 2], updatedAt: NOW - PERSIST_MAX_AGE },
      ],
      true,
    )
    expect(input.clientState.mutations).toHaveLength(1)
    const out = pruneForStorage(input, { now: NOW })
    expect(out.clientState.queries.map((q) => q.queryKey)).toEqual([
      ['inbox', 'for-you'],
      ['build', 'acme', 'web', 2],
    ])
    expect(out.clientState.mutations).toEqual([])
    expect(out.buster).toBe('b1')
  })

  it('keeps the newest data within the size budget and skips what does not fit', () => {
    const big = 'x'.repeat(400)
    const input = client([
      { key: ['build', 'a', 'b', 1], updatedAt: NOW - 3000, data: big },
      { key: ['build', 'a', 'b', 2], updatedAt: NOW - 1000, data: big },
      { key: ['build', 'a', 'b', 3], updatedAt: NOW - 2000, data: big },
    ])
    // Room for two of the three entries (each about the same size).
    const one = JSON.stringify(input.clientState.queries[0]).length
    const out = pruneForStorage(input, { now: NOW, maxChars: one * 2 + 20 })
    expect(out.clientState.queries.map((q) => q.queryKey[3])).toEqual([2, 3])
  })
})

describe('parsePersisted', () => {
  it('reads what was written', () => {
    const written = JSON.stringify(client([{ key: ['inbox', 'for-you'] }]))
    expect(parsePersisted(written)?.clientState.queries).toHaveLength(1)
  })

  it('returns nothing for text that is not a stored cache', () => {
    for (const text of ['', 'not json', 'null', '[]', '{}', '{"timestamp":1,"buster":"b"}']) {
      expect(parsePersisted(text)).toBeUndefined()
    }
  })

  it('drops a query entry that is not shaped like one', () => {
    const text = JSON.stringify({
      timestamp: 1,
      buster: 'b',
      clientState: {
        mutations: [],
        queries: [null, 5, { queryKey: 'x' }, ...client([{ key: ['inbox'] }]).clientState.queries],
      },
    })
    expect(parsePersisted(text)?.clientState.queries).toHaveLength(1)
  })
})
