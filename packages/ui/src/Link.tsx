import type { ComponentPropsWithRef } from 'react'

import { cx } from './cx.ts'

import styles from './Link.module.css'

/**
 * An anchor in the accent text colour, underlined on hover. With `target="_blank"` it always adds `rel="noopener"`. It takes every anchor prop and a `ref`,
 * so the app can wrap it with TanStack Router's `createLink`.
 */
export function Link({ className, target, rel, ...rest }: Link.Props) {
  // A link that opens a new tab never gives the new page a handle on this one.
  const safeRel =
    target === '_blank'
      ? [...new Set(`noopener ${rel ?? ''}`.split(/\s+/).filter(Boolean))].join(' ')
      : rel
  return <a {...rest} target={target} rel={safeRel} className={cx(styles.root, className)} />
}

export namespace Link {
  export type Props = ComponentPropsWithRef<'a'>
}
