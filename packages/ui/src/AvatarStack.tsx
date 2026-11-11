import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { cx } from './cx.ts'
import { Tooltip } from './Tooltip.tsx'

import styles from './AvatarStack.module.css'

declare module 'react' {
  // The custom properties the stack's CSS reads.
  interface CSSProperties {
    '--stack-size'?: string
    '--stack-overlap'?: string
    '--stack-gap'?: string
  }
}

/**
 * Avatars (or links around them) laid out overlapping, each ringed in the surface colour so the
 * overlap reads. When the stack is hovered or has focus inside, the items spread apart: the
 * overlap goes and a small gap opens, with a spring-like overshoot. The spread moves the items'
 * margins, so the stack grows and whatever follows it on the line moves along with it.
 *
 * Each child is one item: an `Avatar`, or an `<a>`/`Tooltip` around one. `more` ends the stack
 * with a "+N" chip. The stack is a plain span: pass `aria-hidden` for a purely decorative one.
 */
export function AvatarStack({
  children,
  size = 20,
  overlap = 4,
  gap = 2,
  shape = 'round',
  ring = 'raised',
  spread = true,
  more,
  className,
  style,
  ...rest
}: AvatarStack.Props) {
  const items = Children.toArray(children)
  const stackStyle: CSSProperties = {
    ...style,
    '--stack-size': `${size}px`,
    '--stack-overlap': `${overlap}px`,
    '--stack-gap': `${gap}px`,
  }
  return (
    <span
      {...rest}
      className={cx(styles.root, className)}
      style={stackStyle}
      data-shape={shape}
      data-ring={ring}
      data-spread={spread ? 'true' : 'false'}
    >
      {items.map((child, i) => (
        <span key={isValidElement(child) ? child.key : `item-${i}`} className={styles.item}>
          {child}
        </span>
      ))}
      {more && more.count > 0 ? (
        <span className={styles.item}>
          <Chip more={more} />
        </span>
      ) : null}
    </span>
  )
}

function Chip({ more }: { more: AvatarStack.More }) {
  const chip = (
    <span
      className={styles.chip}
      {...(more.label === undefined ? {} : { tabIndex: 0, 'aria-label': more.label })}
    >
      +{more.count}
    </span>
  )
  return more.tooltip === undefined ? chip : <Tooltip content={more.tooltip}>{chip}</Tooltip>
}

export namespace AvatarStack {
  export interface More {
    /** The number the chip shows ("+3"); nothing is drawn for 0. */
    count: number
    /** The chip's accessible name; with it the chip is focusable. */
    label?: string
    /** A tooltip on the chip (hover and focus). */
    tooltip?: ReactNode
  }

  export interface Props extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
    /** The items, in order; each gets its own overlapping slot. */
    children?: ReactNode
    /** Diameter in px of the items (and the height of the chip); 20. */
    size?: number
    /** How far each item sits over the one before it, in px; 4. */
    overlap?: number
    /** The gap between items once spread, in px; 2. */
    gap?: number
    /** The ring's shape: `round` for people, `rounded` for the rounded squares of teams; `round`. */
    shape?: 'round' | 'rounded'
    /** The surface the stack sits on, which the ring matches: `raised` (cards, rows) or `chrome` (the bars); `raised`. */
    ring?: 'raised' | 'chrome'
    /** Spread on hover and focus; false keeps it still (a phone's tab icon); true. */
    spread?: boolean
    /** Ends the stack with a "+N" chip. */
    more?: More
  }
}
