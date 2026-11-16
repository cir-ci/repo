import { afterEach, describe, expect, it, vi } from 'vitest'

import { RECENT_SEARCHES_KEY, useRecentSearchesStore } from '#lib/stores/recent-searches-store.ts'
import { RECENT_KEY, useRecentStore } from '#lib/stores/recent-store.ts'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('forgetAll', () => {
  it("empties recent visits and searches, in memory and in the browser's storage", () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    useRecentStore.getState().record('acme', {
      kind: 'build',
      id: 'b1',
      label: 'Build #1',
      path: '/acme/web/builds/1',
      at: 1,
    })
    useRecentSearchesStore.getState().record('acme', 'checkout')
    expect(storage.data.has(RECENT_KEY)).toBe(true)
    expect(storage.data.has(RECENT_SEARCHES_KEY)).toBe(true)

    useRecentStore.getState().forgetAll()
    useRecentSearchesStore.getState().forgetAll()

    expect(useRecentStore.getState().byWorkspace).toEqual({})
    expect(useRecentSearchesStore.getState().byWorkspace).toEqual({})
    expect(storage.data.has(RECENT_KEY)).toBe(false)
    expect(storage.data.has(RECENT_SEARCHES_KEY)).toBe(false)
  })
})
