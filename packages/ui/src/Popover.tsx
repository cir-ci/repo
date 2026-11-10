import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ReactElement, ReactNode } from 'react'

import { Button } from './Button.tsx'
import { cx } from './cx.ts'

import styles from './Popover.module.css'

/**
 * A small panel anchored to a button, on Base UI's `Popover`: for a filter's choices or a list's
 * display options. Unlike `Menu` its content is free-form (fields, switches, buttons) and Tab
 * moves through it. Escape or a click outside closes it and focus returns to the trigger.
 *
 * `trigger` is the element that opens it and keeps its own accessible name; `label` names the
 * panel (a dialog landmark). Without a `trigger` it is anchored to `anchor` (an element or a ref
 * to one) and is controlled with `open`: the region comment box. `modal="trap-focus"` keeps Tab
 * inside it (the page stays usable); `initialFocus` and `finalFocus` say where focus goes on open
 * and close. Near the edge of the window it flips to the other side and shifts to stay on screen.
 */
export function Popover({
  trigger,
  label,
  align = 'start',
  side,
  anchor,
  sideOffset = 4,
  initialFocus,
  finalFocus,
  arrow = false,
  className,
  children,
  popupProps,
  ...rest
}: Popover.Props) {
  return (
    <BasePopover.Root {...rest}>
      {trigger ? <BasePopover.Trigger render={trigger} /> : null}
      <BasePopover.Portal>
        <BasePopover.Positioner
          className={styles.positioner}
          sideOffset={sideOffset}
          align={align}
          anchor={anchor}
          side={side}
        >
          <BasePopover.Popup
            {...popupProps}
            aria-label={label}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cx(styles.popup, className)}
          >
            {arrow ? <BasePopover.Arrow className={styles.arrow} /> : null}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

/** A button that closes the `Popover` it is in (the reason is `close-press`), with `Button`'s look. */
export function PopoverClose(props: Button.Props) {
  return <BasePopover.Close nativeButton render={<Button {...props} />} />
}

export namespace Popover {
  export interface Props extends Omit<BasePopover.Root.Props, 'children'> {
    trigger?: ReactElement<Record<string, unknown>>
    /** What it points at when there is no `trigger`. */
    anchor?: BasePopover.Positioner.Props['anchor']
    side?: BasePopover.Positioner.Props['side']
    sideOffset?: number
    initialFocus?: BasePopover.Popup.Props['initialFocus']
    finalFocus?: BasePopover.Popup.Props['finalFocus']
    /** A small pointer from the panel to what it is anchored to. */
    arrow?: boolean
    /** Extra props for the panel itself (event handlers). */
    popupProps?: Omit<BasePopover.Popup.Props, 'className' | 'children' | 'aria-label' | 'render'>
    /** The panel's accessible name. */
    label: string
    align?: 'start' | 'center' | 'end'
    className?: string
    children?: ReactNode
  }
}
