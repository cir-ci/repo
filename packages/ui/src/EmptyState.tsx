import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { InboxIcon } from './icons.ts'

import styles from './EmptyState.module.css'

/**
 * Provisional (docs/design-gaps.md §5): centred in the panel, a 32px icon, a title, one line of
 * explanation and at most one action. `tone="rejected"` is the error variant (the page's own
 * words and a retry button as `action`).
 */
export function EmptyState({
  icon,
  title,
  headingLevel = 2,
  tone = 'neutral',
  action,
  className,
  children,
}: EmptyState.Props) {
  const Heading = `h${headingLevel}` as const
  return (
    <div data-tone={tone} className={cx(styles['root'], className)}>
      <span className={styles['icon']} aria-hidden="true">
        {icon ?? <InboxIcon size={32} />}
      </span>
      <Heading className={styles['title']}>{title}</Heading>
      {children ? <p className={styles['description']}>{children}</p> : null}
      {action ? <div className={styles['action']}>{action}</div> : null}
    </div>
  )
}

export namespace EmptyState {
  export interface Props {
    /** A 32px icon; defaults to an inbox. */
    icon?: ReactNode
    title: ReactNode
    /** Which heading level the title is, to fit the page's outline. */
    headingLevel?: 1 | 2 | 3
    /** `rejected` for an error state. */
    tone?: 'neutral' | 'rejected'
    /** The one optional action (a primary button). */
    action?: ReactNode
    className?: string
    /** One line of `text.secondary`. */
    children?: ReactNode
  }
}
