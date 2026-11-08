import { beforeEach, describe, expect, it } from 'vitest'

import { useOverlayStore } from '#lib/stores/overlay-store.ts'

beforeEach(() => useOverlayStore.getState().reset())

describe('the overlay store', () => {
  it('opens and closes each overlay on its own', () => {
    const s = useOverlayStore.getState()
    s.setCommandMenuOpen(true)
    expect(useOverlayStore.getState()).toMatchObject({ commandMenuOpen: true, helpOpen: false })
    s.setHelpOpen(true)
    s.setCommandMenuOpen(false)
    expect(useOverlayStore.getState()).toMatchObject({ commandMenuOpen: false, helpOpen: true })
  })

  it('resets to closed', () => {
    useOverlayStore.getState().setHelpOpen(true)
    useOverlayStore.getState().reset()
    expect(useOverlayStore.getState().helpOpen).toBe(false)
  })
})
