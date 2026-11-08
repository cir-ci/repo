import { type ComponentPropsWithRef, createElement } from 'react'

import { cx } from './cx.ts'

import styles from './Text.module.css'

/**
 * Provisional (docs/design-gaps.md §11): running text on the type scale. `body` 13/400, `small`
 * 12/400 (meta, descriptions), `micro` 11/500 (counts), `mono` 12 in the mono face (SHAs,
 * branches, tokens, diff %). Colour is a tone; the state tones are for state only.
 */
export function Text({
  as = 'span',
  variant = 'body',
  tone = 'primary',
  truncate = false,
  className,
  ...rest
}: Text.Props) {
  return createElement(as, {
    ...rest,
    className: cx(styles.root, className),
    'data-variant': variant,
    'data-tone': tone,
    'data-truncate': truncate ? '' : undefined,
  })
}

export namespace Text {
  export interface Props extends ComponentPropsWithRef<'span'> {
    /** The element to render; `span` by default. */
    as?: 'span' | 'p' | 'div' | 'label' | 'code' | 'small' | 'strong' | 'em' | 'li' | 'dd' | 'dt'
    variant?: 'body' | 'small' | 'micro' | 'mono'
    tone?:
      | 'primary'
      | 'secondary'
      | 'tertiary'
      | 'accent'
      | 'approved'
      | 'review'
      | 'processing'
      | 'rejected'
    /** One line, cut with an ellipsis. The parent must be allowed to shrink (`min-width: 0`). */
    truncate?: boolean
  }
}
