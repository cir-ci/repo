import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'

import styles from './ScrollTarget.module.css'

/** How long the helper waits for the element, which a page renders once its data has loaded. */
export const WAIT_MS = 10_000
/** How long the tint stays on the element. */
export const FLASH_MS = 1600

/** The classes of the tint (a module's names may be undefined to the type checker). */
const CLASSES = [styles.target, styles.flash].filter((name) => name !== undefined)

const FOCUSABLE = 'input, textarea, select, button, [role="combobox"]'

/**
 * Brings the setting a link points at into view: scrolls it under the scroller top
 * (its scroll margin), tints it for a moment and focuses its control. With reduced motion the
 * scroll is a jump and the tint does not fade. Returns a function that ends the tint early.
 */
export function revealElement(element: HTMLElement): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.classList.add(...CLASSES)
  element.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const control = element.matches(FOCUSABLE) ? element : element.querySelector(FOCUSABLE)
  if (control instanceof HTMLElement && !control.matches(':disabled')) {
    control.focus({ preventScroll: true })
  }
  const done = () => element.classList.remove(...CLASSES)
  const timer = window.setTimeout(done, FLASH_MS)
  return () => {
    window.clearTimeout(timer)
    done()
  }
}

/**
 * Calls `onFound` with the element of that ID as soon as it is in the page: now, or when a page
 * that loads its data renders it. Gives up after `WAIT_MS`. Returns a function that stops waiting.
 */
export function whenElement(id: string, onFound: (element: HTMLElement) => void): () => void {
  const now = document.getElementById(id)
  if (now) {
    onFound(now)
    return () => undefined
  }
  const observer = new MutationObserver(() => {
    const found = document.getElementById(id)
    if (!found) return
    stop()
    onFound(found)
  })
  const timer = window.setTimeout(stop, WAIT_MS)
  function stop() {
    observer.disconnect()
    window.clearTimeout(timer)
  }
  observer.observe(document.body, { childList: true, subtree: true })
  return stop
}

/** The element ID a hash names (`#merge-gate` or `merge-gate`), or an empty string. */
export function hashId(hash: string): string {
  const raw = hash.replace(/^#/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * For a settings page: when the address has a hash (`…/settings/general#merge-gate`), waits for
 * the element with that ID (settings pages load their data first, so a plain browser jump finds
 * nothing), then reveals it (`revealElement`). `PageFrame` calls it for every settings-style page.
 */
export function useScrollToHash() {
  const hash = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    const id = hashId(hash)
    if (id === '') return undefined
    let end: (() => void) | undefined
    const stop = whenElement(id, (element) => {
      end = revealElement(element)
    })
    return () => {
      stop()
      end?.()
    }
  }, [hash])
}
