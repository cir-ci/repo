import { Drawer as BaseDrawer } from '@base-ui/react/drawer'
import type { ReactNode } from 'react'

import { ScrollArea } from './ScrollArea.tsx'

import styles from './Drawer.module.css'

/**
 * Provisional: a panel that slides in from the left edge on Base UI's
 * `Drawer`, for the sidebar on narrow screens. 280px wide (at most the viewport minus 48px),
 * `surface.chrome` fill; its content scrolls in a `ScrollArea` (an overlay thumb, as in the sidebar). Focus is trapped, Escape, a click on the backdrop or a swipe to the left
 * close it, and focus returns to what opened it. `title` is its accessible name (not shown).
 *
 * It renders in a portal on `document.body`, outside any wrapper that sets
 * `data-circi-color-scheme`: only the scheme on `<html>` reaches it.
 */
export function Drawer({ title, children, ...rest }: Drawer.Props) {
  return (
    <BaseDrawer.Root swipeDirection="left" {...rest}>
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className={styles.backdrop} />
        <BaseDrawer.Viewport className={styles.viewport}>
          <BaseDrawer.Popup className={styles.popup}>
            <BaseDrawer.Title className={styles.title}>{title}</BaseDrawer.Title>
            <BaseDrawer.Content className={styles.content}>
              {/* As the desktop sidebar: an overlay thumb in the right padding, so entries keep their width. */}
              <ScrollArea
                rootClassName={styles.scrollRoot}
                className={styles.scroller}
                contentClassName={styles.scrollContent}
              >
                {children}
              </ScrollArea>
            </BaseDrawer.Content>
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
