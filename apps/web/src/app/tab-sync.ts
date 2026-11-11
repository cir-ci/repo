import type { RouterHistory } from '@tanstack/react-router'

import { useTabStore } from '#lib/stores/tab-store.ts'
import { hrefOf, activeTab } from '#lib/tabs.ts'

/** An address as the tabs keep it: path, search and hash, with no origin. */
export function hrefFrom(path: string, origin = window.location.origin): string {
  if (path.startsWith('/') && !path.startsWith('//')) return path
  try {
    const url = new URL(path, origin)
    return url.origin === origin ? url.pathname + url.search + url.hash : path
  } catch {
    return path
  }
}

/** Whether a link goes to a page of the app: same origin, not the API, not a file, not another window. */
export function isAppLink(anchor: HTMLAnchorElement, origin = window.location.origin): boolean {
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#')) return false
  try {
    const url = new URL(href, origin)
    return url.origin === origin && !url.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/** The page's fade when another tab is shown: quick, and nothing moves (the strip's highlight glides). */
const SWITCH_FADE_MS = 120

/** Set by a switch of tabs; the page fades in once the router has rendered it (`fadeInSwitchedPage`). */
let switched = false

/**
 * Fades the page in after a switch of tabs, once it is the new tab's page: everything in the
 * panel but the tab row itself. Called when the router has rendered (TabGate); does nothing unless
 * the render followed a switch.
 */
export function fadeInSwitchedPage(): void {
  if (!switched) return
  switched = false
  fadeInPage()
}

function fadeInPage(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const panel = document.querySelector('main')
  if (!panel) return
  for (const part of panel.children) {
    if (part instanceof HTMLElement && !part.hasAttribute('data-tab-row')) {
      part.animate([{ opacity: 0.35 }, { opacity: 1 }], {
        duration: SWITCH_FADE_MS,
        easing: 'ease-out',
      })
    }
  }
}

/** How long a tab's restored scroll position is waited for while its page loads. */
const SCROLL_WAIT_MS = 1500

function restoreScroll(top: number): void {
  const started = Date.now()
  const attempt = () => {
    window.scrollTo({ top })
    // The page may not be tall enough yet (its data is loading): try again a few times.
    if (Math.abs(window.scrollY - top) > 2 && Date.now() - started < SCROLL_WAIT_MS) {
      requestAnimationFrame(attempt)
    }
  }
  requestAnimationFrame(attempt)
}

/**
 * Keeps the one router and the tabs in step, in the installed app.
 *
 * The window's own browser history is never used to go back: every move the router makes is a
 * `replace` of the current entry, and the tab keeps the stack (see `#lib/tabs.ts`). So:
 *
 * - `history.push` (a link, `navigate`) becomes "the active tab visits this address";
 * - `history.replace` (a redirect, a changed filter) changes the active tab's current address;
 * - `history.back`, `forward` and `go` walk the active tab's stack only;
 * - whatever changes the active tab's address (a switch, back, restoring a tab) is shown by
 *   replacing the router's location with it, and the page's scroll position is saved and put back.
 *
 * Returns the function that puts the history's own methods back.
 */
export function installTabSync(history: RouterHistory): () => void {
  const store = useTabStore
  const { push, replace, go, back, forward } = history
  // While the router's own call is being passed on, the store change it caused is already shown.
  let passing = false
  const pass = (change: () => void, call: () => void) => {
    passing = true
    try {
      change()
      call()
    } finally {
      passing = false
    }
  }

  history.push = (path, state, options) =>
    pass(
      () => store.getState().visit(hrefFrom(path)),
      () => replace.call(history, path, state, options),
    )
  history.replace = (path, state, options) =>
    pass(
      () => store.getState().replaceCurrent(hrefFrom(path)),
      () => replace.call(history, path, state, options),
    )
  history.back = () => store.getState().back()
  history.forward = () => store.getState().forward()
  history.go = (index) => {
    for (let i = 0; i < Math.abs(index); i++) {
      if (index < 0) store.getState().back()
      else store.getState().forward()
    }
  }

  let shownId = activeTab(store.getState()).id
  const unsubscribe = store.subscribe((state, before) => {
    if (passing || state.tabs.length === 0) return
    const tab = activeTab(state)
    const target = hrefOf(tab)
    if (tab.id !== shownId) {
      // Leaving a tab: its scroll position is kept for when it comes back.
      const left = before.tabs.find((t) => t.id === shownId)
      if (left) {
        passing = true
        try {
          store.getState().setScroll(left.id, window.scrollY)
        } finally {
          passing = false
        }
      }
      shownId = tab.id
      switched = true
    }
    if (hrefFrom(history.location.href) === target) return
    passing = true
    try {
      replace.call(history, target)
    } finally {
      passing = false
    }
    const scroll = activeTab(store.getState()).scroll
    if (scroll !== undefined) restoreScroll(scroll)
    else window.scrollTo({ top: 0 })
  })

  // The window opened on the saved tab's page, not necessarily the address it was launched at.
  const first = hrefOf(activeTab(store.getState()))
  if (hrefFrom(history.location.href) !== first) replace.call(history, first)

  return () => {
    unsubscribe()
    Object.assign(history, { push, replace, go, back, forward })
  }
}
