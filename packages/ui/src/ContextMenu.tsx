import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import type { ReactElement, ReactNode } from 'react'

import { cx } from './cx.ts'
import type { Menu } from './Menu.tsx'
import { MenuEntries } from './MenuEntries.tsx'

import styles from './Menu.module.css'

/**
 * A menu of quick actions that opens on a right click or a long press (touch) on its `trigger`,
 * the row, which stays the one element: it gets the menu's handlers and is not wrapped. The
 * context menu key and Shift+F10 fire the same `contextmenu` event on a focused row, which opens
 * it there. Items, separators, icons, shortcuts and the danger tone are `Menu`'s.
 */
export function ContextMenu({
  trigger,
  children,
  items,
  size = 'sm',
  className,
  ...rest
}: ContextMenu.Props) {
  // Nothing to offer: the row is left alone and the browser's own menu shows.
  if (items.length === 0) return trigger ?? <>{children}</>
  return (
    <BaseContextMenu.Root {...rest}>
      <BaseContextMenu.Trigger
        render={trigger ?? <div className={styles.contents} />}
        {...(trigger ? {} : { children })}
      />
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className={styles.positioner}>
          <BaseContextMenu.Popup className={cx(styles.popup, className)} data-size={size}>
            <MenuEntries items={items} />
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  )
}

export namespace ContextMenu {
  export interface Props extends Omit<BaseContextMenu.Root.Props, 'children'> {
    /** The row that opens it: one element, rendered as is (it must pass its props on to the DOM). */
    trigger?: ReactElement<Record<string, unknown>>
    /** Instead of `trigger`: anything that renders its own element. A wrapper with no box of its own (`display: contents`) catches the right click, the long press and the context key from inside it. */
    children?: ReactNode
    items: ReadonlyArray<Menu.Entry>
    /** Item height: `sm` 28px, `md` 36px. */
    size?: 'sm' | 'md'
    className?: string
  }
}
