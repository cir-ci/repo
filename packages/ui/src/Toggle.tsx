import { Toggle as BaseToggle } from '@base-ui/react/toggle'

import { cx } from './cx.ts'

import styles from './Toggle.module.css'

/**
 * A button that is on or off, on Base UI's `Toggle`: `aria-pressed`, Space and Enter toggle it, and
 * `data-pressed` is on while it is. Its name stays the same in both states (it says what is
 * switched, not what a press does): "View as table", pressed while the table is showing. For one
 * choice among several use `SegmentedControl`.
 */
export function Toggle({ className, ...rest }: Toggle.Props) {
  return <BaseToggle {...rest} className={cx(styles.root, className)} />
}

export namespace Toggle {
  export interface Props extends Omit<BaseToggle.Props, 'className' | 'render'> {
    className?: string
  }
}
