import type { MouseEventHandler, ReactNode } from 'react'

import styles from './BottomBar.module.css'

/**
 * The phone's tab bar: a landmark at the bottom of the frame (`AppFrame`'s `bottomBar`), 56px of
 * 44px-or-larger targets plus the home indicator's safe-area inset. Put `BottomBarItem`s inside,
 * at most five.
 */
export function BottomBar({ label, children }: BottomBar.Props) {
  return (
    <nav aria-label={label} className={styles.root}>
      {children}
    </nav>
  )
}

/** One tab: an icon over a label, a count badge, `selected` for the current page. A link with `href`, else a button. */
export function BottomBarItem(props: BottomBarItem.Props) {
  const content = (
    <>
      <span className={styles.icon} aria-hidden="true">
        {props.icon}
        {props.count === undefined ? null : <span className={styles.count}>{props.count}</span>}
      </span>
      <span className={styles.label}>
        {props.children}
        {props.count === undefined ? null : (
          <span className={styles.hidden}>
            {`, ${props.count}${props.countLabel ? ` ${props.countLabel}` : ''}`}
          </span>
        )}
      </span>
    </>
  )
  const common = {
    className: styles.item,
    onClick: props.onClick,
    'aria-current': props.selected ? ('page' as const) : undefined,
    'data-selected': props.selected ? '' : undefined,
  }
  return props.href ? (
    <a {...common} href={props.href}>
      {content}
    </a>
  ) : (
    <button {...common} type="button" aria-haspopup={props.opensSheet ? 'dialog' : undefined}>
      {content}
    </button>
  )
}

export namespace BottomBar {
  export interface Props {
    /** The landmark's name ("Main"). */
    label: string
    children: ReactNode
  }
}

export namespace BottomBarItem {
  export interface Props {
    children: ReactNode
    icon: ReactNode
    href?: string
    /** Gets the click event, so a router can `preventDefault` and navigate without a reload. */
    onClick?: MouseEventHandler<HTMLElement>
    selected?: boolean
    /** A badge over the icon; announced with the name. */
    count?: number | string
    /** What the count counts, for the accessible name ("unread"). */
    countLabel?: string
    /** The tab opens a sheet (More) rather than a page. */
    opensSheet?: boolean
  }
}
