import { useEffect, useState } from 'react'

/** The installed app: its window already says it's CirCI, so the title leaves the name out. */
const INSTALLED = '(display-mode: standalone), (display-mode: window-controls-overlay)'

/** The page's title from its parts, most specific first: "Build #2 · web-app · CirCI", or without "CirCI" when installed. */
export function documentTitle(parts: readonly (string | undefined)[], installed: boolean): string {
  const named = parts.filter(Boolean)
  return installed && named.length > 0 ? named.join(' · ') : [...named, 'CirCI'].join(' · ')
}

/** Whether the dashboard runs as the installed app (its own window, no browser tabs). */
export const isInstalled = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(INSTALLED).matches

/** The installed app with its own title bar strip (the manifest's window-controls-overlay mode, desktop Chromium). */
export const isOverlay = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(display-mode: window-controls-overlay)').matches

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
