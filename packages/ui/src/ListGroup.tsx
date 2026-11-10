import { Collapsible } from '@base-ui/react/collapsible'
import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from './cx.ts'
import { onDisclosureArrow } from './disclosure-keys.ts'
import { ChevronRightIcon } from './icons.ts'

import styles from './ListGroup.module.css'

/**
 * The bar above a group of rows, the same in every grouped list (Triage, Builds, Baselines,
 * Reviews, a build's screenshots): an optional glyph, the label, the count. It is a heading
 * (`level`, 2 by default). Give it `expanded` and `onExpandedChange` and the heading holds a
 * button with a chevron and `aria-expanded` (Enter, Space, Right and Left toggle it), on Base UI's
 * `Collapsible`: the `children` (the group's rows) are its panel, shown while `expanded`.
 */
export function ListGroup({
  label,
  count,
  countLabel,
  glyph,
  level = 2,
  expanded,
  onExpandedChange,
  children,
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
  if (expanded === undefined) {
    return (
      <Heading {...rest} className={cx(styles.root, className)}>
        <span className={styles.bar}>{content}</span>
      </Heading>
    )
  }
  return (
    <Collapsible.Root open={expanded} onOpenChange={(open) => onExpandedChange?.(open)}>
      <Heading {...rest} className={cx(styles.root, className)}>
        <Collapsible.Trigger
          className={cx(styles.bar, styles.button)}
          onKeyDown={onDisclosureArrow}
        >
          {content}
        </Collapsible.Trigger>
      </Heading>
      <Collapsible.Panel className={styles.panel}>{children}</Collapsible.Panel>
    </Collapsible.Root>
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
    /** The group's rows: shown while `expanded`, and the panel the button controls. */
    children?: ReactNode
  }
}
