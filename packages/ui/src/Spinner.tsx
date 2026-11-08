import { cx } from './cx.ts'

import styles from './Spinner.module.css'

/**
 * Provisional (docs/design-gaps.md §5): a 12 or 16px ring in `text.tertiary`. Without `label` it
 * is decorative (hidden from assistive tech); with one it is an image named by it. Announce
 * progress with `useAnnounce` rather than relying on the spinner.
 */
export function Spinner({ size = 16, label, className }: Spinner.Props) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-size={size}
      className={cx(styles['root'], className)}
    />
  )
}

export namespace Spinner {
  export interface Props {
    size?: 12 | 16
    label?: string
    className?: string
  }
}
