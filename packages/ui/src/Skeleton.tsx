import { cx } from './cx.ts'

import styles from './Skeleton.module.css'

/**
 * Provisional (docs/design-gaps.md §5): a shimmering placeholder bar. It is visible at once;
 * wrap placeholders in `Delayed` so a fast load never flashes them. Hidden from assistive tech.
 */
export function Skeleton({ width = '100%', height = 14, className }: Skeleton.Props) {
  return (
    <span
      aria-hidden="true"
      data-slot="skeleton"
      className={cx(styles['root'], className)}
      style={{ width, height }}
    />
  )
}

export namespace Skeleton {
  export interface Props {
    /** A CSS length or number of px. */
    width?: number | string
    height?: number | string
    className?: string
  }
}

/** Rows of 44px with two bars each, shaped like a list of `ListRow`s. */
export function ListSkeleton({ rows = 5, className }: ListSkeleton.Props) {
  return (
    <div aria-hidden="true" data-slot="skeleton-list" className={cx(styles['list'], className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-slot="skeleton-row" className={styles['row']}>
          <Skeleton width="30%" height={12} />
          <Skeleton width="55%" height={10} />
        </div>
      ))}
    </div>
  )
}

export namespace ListSkeleton {
  export interface Props {
    rows?: number
    className?: string
  }
}
