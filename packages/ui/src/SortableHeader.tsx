import { type ComponentPropsWithRef } from 'react'

import { cx } from './cx.ts'
import { ExpandLessIcon, ExpandMoreIcon } from './icons.ts'

import styles from './SortableHeader.module.css'

/**
 * A column header that sorts its table: a `<button>` inside the `<th>`, with `aria-sort` on the
 * `<th>` and an up (ascending) or down (descending) chevron while the column is the one sorted.
 * It holds no state: the table owns the sort and `onSort` asks for the next one (the cycle is
 * ascending, descending, then the table's own order again; see `nextSort` in the web app's
 * `lib/sort.ts`). `as="div"` renders a `role="columnheader"` for a grid-built table.
 */
export function SortableHeader({
  sort = 'none',
  onSort,
  as = 'th',
  numeric = false,
  className,
  children,
  ...rest
}: SortableHeader.Props) {
  const Cell = as
  return (
    <Cell
      {...rest}
      {...(as === 'th' ? {} : { role: 'columnheader' })}
      aria-sort={sort}
      data-numeric={numeric ? '' : undefined}
      className={cx(styles.root, className)}
    >
      <button type="button" className={styles.button} onClick={onSort}>
        <span>{children}</span>
        <span className={styles.chevron} aria-hidden="true">
          {sort === 'ascending' ? (
            <ExpandLessIcon size={14} />
          ) : sort === 'descending' ? (
            <ExpandMoreIcon size={14} />
          ) : null}
        </span>
      </button>
    </Cell>
  )
}

export namespace SortableHeader {
  export interface Props extends Omit<ComponentPropsWithRef<'th'>, 'onClick' | 'align'> {
    /** How the table is sorted by this column right now. */
    sort?: 'none' | 'ascending' | 'descending'
    /** The header was pressed: the table moves to the next sort. */
    onSort: () => void
    /** `div` for a table built from a grid (it gets `role="columnheader"`). */
    as?: 'th' | 'div'
    /** A column of numbers: the label sits at the right, over its figures. */
    numeric?: boolean
  }
}
