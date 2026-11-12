import { useEffect, useState, useSyncExternalStore } from 'react'

/** The installed app: its window already says it's CirCI, so the title leaves the name out. */
const INSTALLED = '(display-mode: standalone), (display-mode: window-controls-overlay)'

/** The page's title from its parts, most specific first: "Build #2 · web-app · CirCI", or without "CirCI" when installed. */
export function documentTitle(parts: readonly (string | undefined)[], installed: boolean): string {
  const named = parts.filter(Boolean)
  return installed && named.length > 0 ? named.join(' · ') : [...named, 'CirCI'].join(' · ')
}

const OVERLAY = '(display-mode: window-controls-overlay)'
const FULLSCREEN = '(display-mode: fullscreen)'
/** Set once this window has been the installed app, so full screen (its own display mode) keeps it so. */
const SEEN_INSTALLED = 'circi-installed-window'

const matches = (query: string) =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(query).matches

function remember(): void {
  try {
    window.sessionStorage.setItem(SEEN_INSTALLED, '1')
  } catch {
    // No storage: the launch address and the display mode still say so while they last.
  }
}

function seenInstalled(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_INSTALLED) === '1'
  } catch {
    return false
  }
}

/**
 * Launched as the app: the manifest's `start_url` is `/?source=pwa`, so a window that opened there
 * is the installed app, whatever its display mode (full screen, the manifest's first choice, is
 * also what a browser's own full screen reports). iOS's home-screen apps also say `standalone`.
 */
function launchedAsApp(): boolean {
  if (typeof window === 'undefined') return false
  const ios = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios || new URLSearchParams(window.location.search).get('source') === 'pwa'
}

/**
 * Whether the dashboard runs as the installed app (its own window, no browser tabs): its own
 * display modes (standalone, window-controls-overlay), or launched as the app (`launchedAsApp`),
 * or full screen in a window that was the installed app before (this session; the launch address
 * is gone after the first navigation) or has no browser toolbar. Once true, it stays true for the
 * session, so the app keeps its tabs whatever the display mode becomes.
 */
export function isInstalled(): boolean {
  if (matches(INSTALLED) || launchedAsApp()) {
    remember()
    return true
  }
  return matches(FULLSCREEN) && (seenInstalled() || !window.toolbar.visible)
}

/** The installed app with its own title bar strip (the manifest's window-controls-overlay mode, desktop Chromium). */
export const isOverlay = () => matches(OVERLAY)

/** Calls `onChange` whenever the window's display mode changes (entering or leaving full screen, say). */
function subscribeDisplayMode(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const lists = [INSTALLED, OVERLAY, FULLSCREEN].map((query) => window.matchMedia(query))
  for (const list of lists) list.addEventListener('change', onChange)
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange)
  }
}

/** `isInstalled()`, followed as the display mode changes: components that show or hide on it use this. */
export const useInstalled = () =>
  useSyncExternalStore(subscribeDisplayMode, isInstalled, () => false)

/** `isOverlay()`, followed as the display mode changes (full screen has no title bar strip). */
export const useOverlay = () => useSyncExternalStore(subscribeDisplayMode, isOverlay, () => false)

/** The page's title as the browser has it, followed as pages change it. */
export function useWindowTitle(): string {
  const [title, setTitle] = useState(() => document.title)
  useEffect(() => {
    const observer = new MutationObserver(() => setTitle(document.title))
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [])
  return title
}

/** Sets the browser tab title, most specific first: "Build #2 · web-app · CirCI". */
export function useDocumentTitle(...parts: (string | undefined)[]) {
  const title = documentTitle(parts, isInstalled())
  useEffect(() => {
    document.title = title
  }, [title])
}
