import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './SectionHeader.module.css'

/**
 * Provisional (docs/design-gaps.md §2): the heading of a settings section, 13px/600 with one line
 * of `text.secondary` description and an optional action on the right. `divided` puts a hairline
 * above it to separate it from the previous section.
 */
export function SectionHeader({
  title,
  description,
  action,
  headingLevel = 2,
  divided = false,
  className,
}: SectionHeader.Props) {
  const Heading = `h${headingLevel}` as const
  return (
    <header data-divided={divided ? '' : undefined} className={cx(styles.root, className)}>
      <div className={styles.text}>
        <Heading className={styles.title}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </header>
  )
}

export namespace SectionHeader {
  export interface Props {
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
    headingLevel?: 1 | 2 | 3 | 4
    divided?: boolean
    className?: string
  }
}
