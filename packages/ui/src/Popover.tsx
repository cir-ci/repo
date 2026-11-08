import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ReactElement, ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './Popover.module.css'

/**
 * A small panel anchored to a button, on Base UI's `Popover`: for a filter's choices or a list's
 * display options. Unlike `Menu` its content is free-form (fields, switches, buttons) and Tab
 * moves through it. Escape or a click outside closes it and focus returns to the trigger.
 *
 * `trigger` is the element that opens it and keeps its own accessible name; `label` names the
 * panel (a dialog landmark).
 */
export function Popover({
  trigger,
  label,
  open,
  onOpenChange,
  align = 'start',
  className,
  children,
}: Popover.Props) {
  return (
    <BasePopover.Root
      open={open}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
    >
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className={styles['positioner']} sideOffset={4} align={align}>
          <BasePopover.Popup aria-label={label} className={cx(styles['popup'], className)}>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

export namespace Popover {
  export interface Props {
    trigger: ReactElement<Record<string, unknown>>
    /** The panel's accessible name. */
    label: string
    open?: boolean
    onOpenChange?: (open: boolean) => void
    align?: 'start' | 'center' | 'end'
    className?: string
    children?: ReactNode
  }
}
