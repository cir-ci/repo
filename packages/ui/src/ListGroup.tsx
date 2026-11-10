import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react'

import { cx } from './cx.ts'
import { ChevronRightIcon } from './icons.ts'

import styles from './ListGroup.module.css'

/** Right opens a closed group and Left closes an open one (Enter and Space already toggle). */
function onArrow(event: KeyboardEvent<HTMLElement>) {
  const open = event.currentTarget.getAttribute('aria-expanded') === 'true'
  if ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open)) {
    event.preventDefault()
    event.currentTarget.click()
  }
}

/**
 * The bar above a group of rows, the same in every grouped list (Triage, Builds, Baselines,
 * Reviews, a build's screenshots): an optional glyph, the label, the count. It is a heading
 * (`level`, 2 by default). Give it `expanded` and `onExpandedChange` and the heading holds a
 * button with a chevron and `aria-expanded` (Enter, Space, Right and Left toggle it); the caller
 * shows or hides the rows.
 */
export function ListGroup({
  label,
  count,
  countLabel,
  glyph,
  level = 2,
  expanded,
  onExpandedChange,
  controls,
  className,
  ...rest
}: ListGroup.Props) {
  const Heading = `h${level}` as const
  const content = (
    <>
      {expanded === undefined ? null : (
        <ChevronRightIcon size={14} strokeWidth={2} className={styles.chevron} aria-hidden="true" />
      )}
      {glyph === undefined ? null : <span className={styles.glyph}>{glyph}</span>}
      <span className={styles.label}>{label}</span>
      {count === undefined ? null : (
        <span className={styles.count} aria-label={countLabel}>
          {count}
        </span>
      )}
    </>
  )
  return (
    <Heading {...rest} className={cx(styles.root, className)}>
      {expanded === undefined ? (
        <span className={styles.bar}>{content}</span>
      ) : (
        <button
          type="button"
          className={cx(styles.bar, styles.button)}
          aria-expanded={expanded}
          aria-controls={controls}
          onClick={() => onExpandedChange?.(!expanded)}
          onKeyDown={onArrow}
        >
          {content}
        </button>
      )}
    </Heading>
  )
}

export namespace ListGroup {
  export interface Props extends Omit<HTMLAttributes<HTMLHeadingElement>, 'children'> {
    label: ReactNode
    /** The number of rows, shown after the label. */
    count?: number
    /** What a screen reader says for the count ("3 items"), when the bare number isn't enough. */
    countLabel?: string
    /** A decorative status glyph before the label; a list without one leaves it out. */
    glyph?: ReactNode
    /** The heading level; 2 by default. */
    level?: 2 | 3
    /** Makes the bar a disclosure button: whether the group's rows are shown. */
    expanded?: boolean
    onExpandedChange?: (expanded: boolean) => void
    /** The ID of the element the button shows and hides. */
    controls?: string
  }
}
