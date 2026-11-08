import { type ComponentPropsWithRef, createElement } from 'react'

import { cx } from './cx.ts'

import styles from './Heading.module.css'

const DEFAULT_ELEMENT = { display: 'h1', title: 'h2', heading: 'h3' } as const

/**
 * Provisional (docs/design-gaps.md §11): `display` 20/600 (login and setup titles only), `title`
 * 15/600 (dialog and empty-state titles), `heading` 13/600 (section headings). The level is the
 * look; `as` picks the element when the document outline needs another one.
 */
export function Heading({ level = 'heading', as, className, ...rest }: Heading.Props) {
  return createElement(as ?? DEFAULT_ELEMENT[level], {
    ...rest,
    className: cx(styles.root, className),
    'data-level': level,
  })
}

export namespace Heading {
  export interface Props extends ComponentPropsWithRef<'h2'> {
    level?: 'display' | 'title' | 'heading'
    /** Defaults: `display` is an `h1`, `title` an `h2`, `heading` an `h3`. */
    as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div' | 'p' | 'span'
  }
}
