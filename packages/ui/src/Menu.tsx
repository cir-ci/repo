import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { ReactElement, ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './Menu.module.css'

/**
 * Provisional (docs/design-gaps.md §4): a dropdown on Base UI's `Menu`. Arrow keys move, type-
 * ahead jumps, Enter or Space picks, Escape closes and focus returns to the trigger. Items are
 * 28px high; an item may show shortcut text on the right (`Kbd`-style, display only: it does
 * not bind the key).
 *
 * `trigger` is the element that opens it (a `Button`, `IconButton`, avatar button…); it keeps its
 * own accessible name.
 */
export function Menu({ trigger, items, align = 'start', className }: Menu.Props) {
  const keyed = items.map((entry, index) => ({
    entry,
    key:
      entry.type === 'separator'
        ? `separator-${items.slice(0, index).filter((e) => e.type === 'separator').length}`
        : entry.type === 'content'
          ? `content-${entry.name}`
          : `item-${entry.label}`,
  }))
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles['positioner']} sideOffset={4} align={align}>
          <BaseMenu.Popup className={cx(styles['popup'], className)}>
            {keyed.map(({ entry, key }) =>
              entry.type === 'separator' ? (
                <BaseMenu.Separator key={key} className={styles['separator']} />
              ) : entry.type === 'content' ? (
                <div
                  key={key}
                  className={styles['content']}
                  // The control keeps its own arrow keys instead of the menu moving between items.
                  onKeyDown={(event) => {
                    if (
                      event.key.startsWith('Arrow') ||
                      event.key === 'Home' ||
                      event.key === 'End'
                    )
                      event.stopPropagation()
                  }}
                >
                  {entry.node}
                </div>
              ) : (
                <BaseMenu.Item
                  key={key}
                  className={styles['item']}
                  data-tone={entry.tone}
                  disabled={entry.disabled}
                  aria-keyshortcuts={entry.shortcut}
                  onClick={entry.onSelect}
                >
                  {entry.icon ? (
                    <span className={styles['icon']} aria-hidden="true">
                      {entry.icon}
                    </span>
                  ) : null}
                  <span className={styles['label']}>{entry.label}</span>
                  {entry.shortcut ? (
                    <kbd className={styles['shortcut']} aria-hidden="true">
                      {entry.shortcut}
                    </kbd>
                  ) : null}
                </BaseMenu.Item>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

export namespace Menu {
  export interface Item {
    type?: 'item'
    label: string
    onSelect?: () => void
    /** A 16px icon before the label. */
    icon?: ReactNode
    /** Shortcut text shown on the right ("⌘K"); hidden from the item's name, exposed as `aria-keyshortcuts`. */
    shortcut?: string
    /** `danger` colours the item with the rejected state (remove, delete). */
    tone?: 'danger'
    disabled?: boolean
  }

  export interface Separator {
    type: 'separator'
  }

  /** A control inside the menu that isn't an item (a theme switch). It keeps its own arrow keys. */
  export interface Content {
    type: 'content'
    /** Identifies the entry (the key); also used as its accessible grouping name. */
    name: string
    node: ReactNode
  }

  export type Entry = Item | Separator | Content

  export interface Props {
    trigger: ReactElement<Record<string, unknown>>
    items: ReadonlyArray<Entry>
    align?: 'start' | 'center' | 'end'
    className?: string
  }
}
