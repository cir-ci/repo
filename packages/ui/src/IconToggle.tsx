import { Toggle as BaseToggle } from '@base-ui/react/toggle'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './IconToggle.module.css'

/**
 * A 28×28 `IconButton` look that is on or off, on Base UI's `Toggle`: `aria-pressed`, Space and
 * Enter toggle it, `data-pressed` is on while it is. `label` is the accessible name and stays the
 * same in both states.
 */
export function IconToggle({ label, children, className, ...rest }: IconToggle.Props) {
  return (
    <BaseToggle {...rest} aria-label={label} className={cx(styles.root, className)}>
      {children}
    </BaseToggle>
  )
}

export namespace IconToggle {
  export interface Props extends Omit<
    BaseToggle.Props,
    'render' | 'children' | 'className' | 'aria-label' | 'aria-labelledby'
  > {
    /** The accessible name ("Draw a region"). */
    label: string
    /** The icon, 16px. */
    children: ReactNode
    className?: string
  }
}
