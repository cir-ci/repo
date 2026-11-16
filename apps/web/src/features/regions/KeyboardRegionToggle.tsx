import { IconToggle, Tooltip } from '@circi/ui'

import styles from './KeyboardRegionToggle.module.css'

const ROOT_SELECTOR = '[data-keyboard-region-toggle] button'

/**
 * Puts focus back on the toggle once a keyboard region (or its comment box) is canceled, but only
 * when focus has nowhere else to be (it fell to the page): the toggle is found in the document,
 * as the element focus left may be gone by then (the tool and the box unmount).
 */
export function restoreKeyboardRegionFocus() {
  requestAnimationFrame(() => {
    const active = document.activeElement
    if (active && active !== document.body) return
    document.querySelector<HTMLElement>(ROOT_SELECTOR)?.focus()
  })
}

/**
 * The keyboard path to marking a region: a toggle that is out of sight until the keyboard reaches it
 * (or it is on). Dragging on the image needs no button, so the board's toolbar doesn't show it.
 */
export function KeyboardRegionToggle({ on, onChange }: KeyboardRegionToggle.Props) {
  return (
    <span className={styles.root} data-keyboard-region-toggle="" data-on={on ? '' : undefined}>
      <Tooltip content="Mark a region with the keyboard: arrow keys move it, Shift and arrow keys resize it, Enter confirms">
        <IconToggle label="Mark a region with the keyboard" pressed={on} onPressedChange={onChange}>
          <span aria-hidden="true">⌖</span>
        </IconToggle>
      </Tooltip>
    </span>
  )
}

export namespace KeyboardRegionToggle {
  export interface Props {
    on: boolean
    onChange: (on: boolean) => void
  }
}
