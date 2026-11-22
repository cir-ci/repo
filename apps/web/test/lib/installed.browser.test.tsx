import { afterEach, describe, expect, it } from 'vitest'

import { isInstalled } from '#lib/document-title.ts'
import { fullScreenOnly } from '#test/support/display-mode.ts'

const start = window.location.href

afterEach(() => {
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
