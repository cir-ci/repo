import { Button as BaseButton } from '@base-ui/react/button'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './IconButton.module.css'

/**
 * Provisional (docs/design-gaps.md §1): a 28×28 ghost button holding one icon. `label` is the
 * accessible name and is required: an icon alone names nothing.
 */
export function IconButton({ label, children, className, ...rest }: IconButton.Props) {
  return (
    <BaseButton type="button" {...rest} aria-label={label} className={cx(styles.root, className)}>
      {children}
    </BaseButton>
  )
}

export namespace IconButton {
  export interface Props extends Omit<
    BaseButton.Props,
    'render' | 'children' | 'className' | 'aria-label' | 'aria-labelledby'
  > {
    /** The accessible name ("Copy token", "Close"). */
    label: string
    /** The icon, 16px (`<X size={16} />`). */
    children: ReactNode
    className?: string
  }
}
