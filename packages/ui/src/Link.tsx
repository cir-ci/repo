import type { ComponentPropsWithRef } from 'react'

import { cx } from './cx.ts'

import styles from './Link.module.css'

/**
 * An anchor in the accent text colour, underlined on hover. It takes every anchor prop and a `ref`,
 * so the app can wrap it with TanStack Router's `createLink`.
 */
export function Link({ className, ...rest }: Link.Props) {
  return <a {...rest} className={cx(styles.root, className)} />
}

export namespace Link {
  export type Props = ComponentPropsWithRef<'a'>
}
