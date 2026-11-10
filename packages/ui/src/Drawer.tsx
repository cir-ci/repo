import { Drawer as BaseDrawer } from '@base-ui/react/drawer'
import type { ReactNode } from 'react'

import { useScrollingFlag } from './use-scrolling.ts'

import styles from './Drawer.module.css'

/**
 * Provisional (docs/design-gaps.md §6): a panel that slides in from the left edge on Base UI's
 * `Drawer`, for the sidebar on narrow screens. 280px wide (at most the viewport minus 48px),
 * `surface.chrome` fill. Focus is trapped, Escape, a click on the backdrop or a swipe to the left
 * close it, and focus returns to what opened it. `title` is its accessible name (not shown).
 *
 * It renders in a portal on `document.body`, outside any wrapper that sets
 * `data-circi-color-scheme`: only the scheme on `<html>` reaches it.
 */
export function Drawer({ title, children, ...rest }: Drawer.Props) {
  const onScroll = useScrollingFlag()
  return (
    <BaseDrawer.Root swipeDirection="left" {...rest}>
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className={styles.backdrop} />
        <BaseDrawer.Viewport className={styles.viewport}>
          <BaseDrawer.Popup className={styles.popup} onScroll={onScroll}>
            <BaseDrawer.Title className={styles.title}>{title}</BaseDrawer.Title>
            <BaseDrawer.Content className={styles.content}>{children}</BaseDrawer.Content>
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  )
}

export namespace Drawer {
  export interface Props extends Omit<BaseDrawer.Root.Props, 'children'> {
    /** The accessible name of the drawer ("Navigation"). */
    title: string
    children?: ReactNode
  }
}
