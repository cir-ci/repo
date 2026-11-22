import { vi } from 'vitest'

type Mode = 'browser' | 'standalone' | 'overlay'

/** A media query list that answers `matches` and never changes (nothing listens for it). */
function frozen(real: MediaQueryList, matches: boolean): MediaQueryList {
  return Object.create(real, {
    matches: { value: matches },
    addEventListener: { value: () => {} },
    removeEventListener: { value: () => {} },
  })
}

/**
 * Runs the dashboard as the installed app (`standalone`, or `overlay` for a title bar the app
 * draws into), or in an ordinary browser tab, by faking the `display-mode` media queries.
 * `setup.ts` puts `matchMedia` back after each test.
 */
export function installedAs(mode: Mode): void {
  const real = window.matchMedia.bind(window)
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!query.includes('display-mode')) return real(query)
    const overlayOnly = query.includes('window-controls-overlay') && !query.includes('standalone')
    const matches = mode === 'browser' ? false : overlayOnly ? mode === 'overlay' : true
    return frozen(real(query), matches)
  })
}

/** Full screen and nothing else, as the app opens when the manifest prefers it. */
export function fullScreenOnly(): void {
  const real = window.matchMedia.bind(window)
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('display-mode')
      ? Object.create(real(query), { matches: { value: query.includes('fullscreen') } })
      : real(query),
  )
}

/**
 * A display mode that can change while the app runs (entering full screen): the media queries
 * follow it, and `switchTo` fires their change events as the browser does.
 */
export function switchableDisplayMode(start: 'standalone' | 'overlay' | 'fullscreen') {
  let mode = start
  const listeners = new Set<() => void>()
  const real = window.matchMedia.bind(window)
  const matchesFor = (query: string) => {
    if (query.includes('fullscreen')) return mode === 'fullscreen'
    const overlayOnly = query.includes('window-controls-overlay') && !query.includes('standalone')
    return overlayOnly ? mode === 'overlay' : mode !== 'fullscreen'
  }
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!query.includes('display-mode')) return real(query)
    return Object.create(real(query), {
      matches: { get: () => matchesFor(query) },
      addEventListener: { value: (_: string, listener: () => void) => listeners.add(listener) },
      removeEventListener: {
        value: (_: string, listener: () => void) => listeners.delete(listener),
      },
    })
  })
  return {
    switchTo(next: typeof mode) {
      mode = next
      for (const listener of listeners) listener()
    },
  }
}
