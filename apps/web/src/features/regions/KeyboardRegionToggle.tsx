import { IconToggle, Tooltip } from '@circi/ui'

import styles from './KeyboardRegionToggle.module.css'

/**
 * The keyboard path to marking a region: a toggle that is out of sight until the keyboard reaches it
 * (or it is on). Dragging on the image needs no button, so the board's toolbar doesn't show it.
 */
export function KeyboardRegionToggle({ on, onChange }: KeyboardRegionToggle.Props) {
  return (
    <span className={styles.root} data-on={on ? '' : undefined}>
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
