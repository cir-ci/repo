import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './SkipLink.module.css'

/**
 * The first focusable thing on a page: off-screen until it takes keyboard focus, then a link to
 * the main content (`href="#main"`, the target needs that `id` and `tabIndex={-1}`).
 */
export function SkipLink({
  href = '#main',
  className,
  children = 'Skip to content',
}: SkipLink.Props) {
  return (
    <a href={href} className={cx(styles.root, className)}>
      {children}
    </a>
  )
}

export namespace SkipLink {
  export interface Props {
    /** The fragment of the main content. */
    href?: string
    className?: string
    children?: ReactNode
  }
}
