import { type ComponentPropsWithRef, createElement } from 'react'

import { cx } from './cx.ts'

import styles from './Stack.module.css'

/**
 * A flex container with a gap from the spacing scale (steps of 4px). Column by default. Layout
 * only: anything it can't express goes in the feature's own CSS module.
 */
export function Stack({
  as = 'div',
  direction = 'column',
  gap = 0,
  align,
  justify,
  wrap = false,
  className,
  ...rest
}: Stack.Props) {
  return createElement(as, {
    ...rest,
    className: cx(styles['root'], className),
    'data-direction': direction,
    'data-gap': gap,
    'data-align': align,
    'data-justify': justify,
    'data-wrap': wrap ? '' : undefined,
  })
}

export namespace Stack {
  export interface Props extends ComponentPropsWithRef<'div'> {
    /** The element to render; `div` by default. */
    as?: 'div' | 'section' | 'ul' | 'ol' | 'li' | 'nav' | 'header' | 'footer' | 'main' | 'span'
    direction?: 'row' | 'column'
    /** Spacing step: 1 = 4px, 2 = 8px, 3 = 12px, 4 = 16px, 5 = 20px, 6 = 24px, 8 = 32px. */
    gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8
    align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
    justify?: 'start' | 'center' | 'end' | 'between'
    wrap?: boolean
  }
}
