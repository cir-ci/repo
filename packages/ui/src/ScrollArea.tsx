import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'

import { cx } from './cx.ts'

import styles from './ScrollArea.module.css'

/**
 * A scroll area with overlay scrollbars, on Base UI's Scroll Area: the viewport keeps scrolling
 * natively (wheel, keys, touch, focus) with its own bars hidden, so the content runs to the edge,
 * and slim 6px thumbs are laid on top, only for an axis that overflows. They show while the area
 * is hovered or scrolled and fade out after; drag a thumb to scroll, press its track to page.
 *
 * `className` and the rest of the props go on the viewport (the element that scrolls: give it its
 * padding, background and gap); `rootClassName` styles the frame around it, which fills its parent
 * like a flex item (`flex: 1 1 0`). The viewport is marked `data-scroll-area`, which the region
 * drag's auto-scroll looks for.
 */
export function ScrollArea({
  className,
  rootClassName,
  contentClassName,
  children,
  ...props
}: ScrollArea.Props) {
  return (
    <BaseScrollArea.Root className={cx(styles.root, rootClassName)}>
      <BaseScrollArea.Viewport
        {...props}
        className={cx(styles.viewport, className)}
        data-scroll-area=""
      >
        {contentClassName === undefined ? (
          children
        ) : (
          <BaseScrollArea.Content className={contentClassName}>{children}</BaseScrollArea.Content>
        )}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar orientation="vertical" className={styles.scrollbar}>
        <BaseScrollArea.Thumb className={styles.thumb} />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar orientation="horizontal" className={styles.scrollbar}>
        <BaseScrollArea.Thumb className={styles.thumb} />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Corner className={styles.corner} />
    </BaseScrollArea.Root>
  )
}

export namespace ScrollArea {
  export interface Props extends Omit<BaseScrollArea.Viewport.Props, 'className'> {
    /** Styles the viewport, the element that scrolls. */
    className?: string | undefined
    /** Styles the frame around the viewport (its size in the parent). */
    rootClassName?: string | undefined
    /**
     * Wraps the children in Base UI's content element, which the scrollbars watch for size changes
     * (without it they notice content that grows after mount only on the first scroll). Give it the
     * layout of the children (flex, gap).
     */
    contentClassName?: string | undefined
  }
}
