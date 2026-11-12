import { afterEach, describe, expect, it, vi } from 'vitest'

import { isInstalled } from '#lib/document-title.ts'

/** Full screen and nothing else, as the app opens now that the manifest prefers it. */
function fullScreenOnly() {
  const real = window.matchMedia.bind(window)
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('display-mode')
      ? Object.create(real(query), { matches: { value: query.includes('fullscreen') } })
      : real(query),
  )
}

const start = window.location.href

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', start)
  window.sessionStorage.clear()
})

describe('isInstalled', () => {
  it('is true for a window launched as the app in full screen, and stays so after the launch address is gone', () => {
    fullScreenOnly()
    window.history.replaceState(null, '', '/?source=pwa')
    expect(isInstalled()).toBe(true)
    // The first redirect drops ?source=pwa; the session remembers the launch.
    window.history.replaceState(null, '', '/inbox')
    expect(isInstalled()).toBe(true)
  })

  it("is false for a browser's own full screen (not launched as the app)", () => {
    fullScreenOnly()
    window.history.replaceState(null, '', '/inbox')
    expect(isInstalled()).toBe(!window.toolbar.visible)
  })
})
