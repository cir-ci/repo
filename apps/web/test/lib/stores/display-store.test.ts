import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DISPLAY, DISPLAY_KEY } from '#features/teams/display-options.ts'
import { useDisplayStore } from '#lib/stores/display-store.ts'

const items = new Map<string, string>()

beforeEach(() => {
  items.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  })
  useDisplayStore.getState().reset()
})
afterEach(() => vi.unstubAllGlobals())

describe('the display store', () => {
  it('persists changes as the plain options JSON', () => {
    useDisplayStore.getState().setDisplay({ ...DEFAULT_DISPLAY, order: 'oldest' })
    expect(JSON.parse(items.get(DISPLAY_KEY) ?? '')).toMatchObject({ order: 'oldest' })
  })

  it('rehydrates from storage, sanitising what it reads', async () => {
    items.set(DISPLAY_KEY, '{"groupBy":"branch","order":"zodiac"}')
    await useDisplayStore.persist.rehydrate()
    expect(useDisplayStore.getState().display).toEqual({ ...DEFAULT_DISPLAY, groupBy: 'branch' })
  })

  it('survives storage that throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    await useDisplayStore.persist.rehydrate()
    expect(() => useDisplayStore.getState().setDisplay(DEFAULT_DISPLAY)).not.toThrow()
    expect(useDisplayStore.getState().display).toEqual(DEFAULT_DISPLAY)
  })
})
