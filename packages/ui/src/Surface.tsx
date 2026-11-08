import { type ComponentPropsWithRef, createElement } from 'react'

import { cx } from './cx.ts'

import styles from './Surface.module.css'

/**
 * A surface on the elevation scale, with a 1px hairline (no shadows): `chrome` is the sidebar and
 * page ground, `panel` the lifted content, `raised` inputs and controls, `overlay` menus and popups.
 */
export function Surface({ as = 'div', variant = 'panel', className, ...rest }: Surface.Props) {
  return createElement(as, {
    ...rest,
    className: cx(styles.root, className),
    'data-variant': variant,
  })
}

export namespace Surface {
  export interface Props extends ComponentPropsWithRef<'div'> {
    /** The element to render; `div` by default. */
    as?:
      | 'div'
      | 'section'
      | 'aside'
      | 'article'
      | 'nav'
      | 'header'
      | 'footer'
      | 'main'
      | 'ul'
      | 'li'
    variant?: 'chrome' | 'panel' | 'raised' | 'overlay'
  }
}
