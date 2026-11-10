import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './Badge.module.css'

/**
 * A small label: `count` is a pill (18px, radius 9) for numbers; `tag` is 20px with radius 4 for
 * words. `tone`: `neutral`, `accent`, or `state` (with `state` naming which one: approved, review,
 * processing, rejected). It is plain text, so a count is read with its neighbours ("Inbox 3").
 */
export function Badge({
  tone = 'neutral',
  shape = 'count',
  state = 'review',
  className,
  children,
  ...rest
}: Badge.Props) {
  return (
    <span
      {...rest}
      className={cx(styles.root, className)}
      data-tone={tone}
      data-shape={shape}
      data-state={tone === 'state' ? state : undefined}
    >
      {children}
    </span>
  )
}

export namespace Badge {
  export interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    tone?: 'neutral' | 'accent' | 'state'
    shape?: 'count' | 'tag'
    /** With `tone="state"`: which state's colour. */
    state?: 'approved' | 'review' | 'processing' | 'failed' | 'rejected'
    children?: ReactNode
  }
}
