import { useEffect, useRef } from 'react'

const DIALOGS = '[role="dialog"], [role="alertdialog"]'

/**
 * Gives focus back to what had it when an overlay opened, once it has closed or unmounted. Base
 * UI returns focus itself when a trigger opens the overlay and the overlay stays mounted; this is
 * for the rest: one that is mounted already open (`{editing ? <Dialog open /> : null}`, or a lazy
 * dialog), where focus would drop to `<body>`. It acts only when focus is on `<body>` after the
 * overlay is gone, and only when what opened it is still on the page.
 */
export function useRestoreFocus(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null)
  // During render, before anything inside the overlay can take focus.
  if (open && opener.current === null) {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) opener.current = active
  }
  useEffect(() => {
    if (!open) return undefined
    return () => {
      const target = opener.current
      opener.current = null
      if (target) restoreWhenGone(target)
    }
  }, [open])
}

function restoreWhenGone(target: HTMLElement) {
  let attempts = 0
  const step = () => {
    attempts += 1
    const active = document.activeElement
    const lost = !active || active === document.body
    if (lost && !document.querySelector(DIALOGS)) {
      if (target.isConnected) target.focus()
      return
    }
    // Focus went somewhere on its own (Base UI's return, a page's choice): leave it.
    if (!lost && !active.closest(DIALOGS)) return
    if (attempts < 20) window.setTimeout(step, 50)
  }
  window.setTimeout(step, 0)
}
