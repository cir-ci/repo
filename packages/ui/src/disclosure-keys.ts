import type { KeyboardEvent } from 'react'

/** Right opens a closed disclosure and Left closes an open one (Enter and Space already toggle). */
export function onDisclosureArrow(event: KeyboardEvent<HTMLElement>) {
  const open = event.currentTarget.getAttribute('aria-expanded') === 'true'
  if ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open)) {
    event.preventDefault()
    event.currentTarget.click()
  }
}
