import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { MouseEventHandler, ReactElement, ReactNode } from 'react'

import { cx } from './cx.ts'
import { MenuEntries } from './MenuEntries.tsx'

import styles from './Menu.module.css'

/**
 * Provisional: a dropdown on Base UI's `Menu`. Arrow keys move, type-
 * ahead jumps, Enter or Space picks, Escape closes and focus returns to the trigger. Items are
 * 28px high (`size="md"`: 36px rows, 14px text, 18px icons at stroke 2: the sidebar's workspace and account menus); an item may show shortcut text on the right (`Kbd`-style, display only: it does
 * not bind the key).
 *
 * `trigger` is the element that opens it (a `Button`, `IconButton`, avatar button…); it keeps its
 * own accessible name.
 */
export function Menu({
  trigger,
  items,
  align = 'start',
  size = 'sm',
  className,
  ...rest
}: Menu.Props) {
  return (
    <BaseMenu.Root {...rest}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles.positioner} sideOffset={4} align={align}>
          <BaseMenu.Popup className={cx(styles.popup, className)} data-size={size}>
            <MenuEntries items={items} />
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
    /** Makes the item a link (an anchor); `onLinkClick` can route it client-side (`preventDefault()`). */
    href?: string
    onLinkClick?: MouseEventHandler<HTMLElement>
    /** An icon before the label: 16px in `sm`, 18px at stroke 2 in `md`. */
    icon?: ReactNode
    /** Shortcut text shown on the right ("⌘K"); hidden from the item's name, exposed as `aria-keyshortcuts`. */
    shortcut?: string
    /** The current choice (the open workspace): announced with `aria-current`. */
    current?: boolean
    /** Something after the label, decorative (a check, a role): hidden from the item's name. */
    trailing?: ReactNode
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

  /** A group of mutually exclusive choices (theme: System, Light, Dark). The chosen one shows a check; arrow keys move, Space or Enter picks. */
  export interface RadioGroup {
    type: 'radio-group'
    /** The group's accessible name and its key. */
    name: string
    value: string
    onValueChange: (value: string) => void
    options: ReadonlyArray<{ value: string; label: string }>
    /** Close the menu after a pick (default: it stays open, so a theme can be tried). */
    closeOnClick?: boolean
  }

  /**
   * A row of icon-only items (a project's pages): each is a real menu item (arrow keys reach it, a
   * pick closes the menu), named by its label, which also shows as a tooltip.
   */
  export interface IconRow {
    type: 'icon-row'
    /** Names the row as a group, and keys it. */
    name: string
    items: ReadonlyArray<{ label: string; icon: ReactNode; onSelect: () => void }>
  }

  /** An on/off choice (checkerboard): a menu item with `role="menuitemcheckbox"`; the check shows while it is on. It stays open so a change can be seen. */
  export interface Checkbox {
    type: 'checkbox'
    label: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    /** Close the menu after a pick (default: it stays open). */
    closeOnClick?: boolean
  }

  export type Entry = Item | Separator | Content | RadioGroup | IconRow | Checkbox

  export interface Props extends Omit<BaseMenu.Root.Props, 'children'> {
    trigger: ReactElement<Record<string, unknown>>
    items: ReadonlyArray<Entry>
    align?: 'start' | 'center' | 'end'
    /** Item height: `sm` 28px, `md` 36px (14px text, 18px icons). */
    size?: 'sm' | 'md'
    className?: string
  }
}
