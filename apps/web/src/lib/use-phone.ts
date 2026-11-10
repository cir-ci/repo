import { useSyncExternalStore } from 'react'

/** The width below which the sidebar is gone and the app is a phone: `AppFrame`'s stacking breakpoint. */
export const COMPACT_QUERY = '(max-width: 819.98px)'

/** `usePhone()` outside a component: for plain functions that build a list (the command menu's). */
export function isPhone(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * Whether the window is phone-sized (under 820px, where the bottom tabs replace the sidebar). Pages use it to give a
 * detail pane a sheet instead of a split; layout that can be CSS stays CSS (media and container queries).
 */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}
