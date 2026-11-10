import type { MouseEventHandler, ReactNode } from 'react'

import { Badge } from './Badge.tsx'

import styles from './NavItem.module.css'

/**
 * One entry of the sidebar (32px, 14px text, an 18px icon at stroke 2; a `sub` item is 28px, 13px text, a 16px icon, and indented). A Lucide icon passed as `icon` is sized here, whatever size it was drawn at. `selected` marks the
 * current page. A `count` is announced as part of the name ("Inbox, 3 unread").
 */
export function NavItem(props: NavItem.Props) {
  const content = (
    <>
      {props.icon ? (
        <span className={styles.icon} aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      <span className={styles.label}>
        {props.children}
        {props.count === undefined ? null : (
          <span
            className={styles.hidden}
          >{`, ${props.count}${props.countLabel ? ` ${props.countLabel}` : ''}`}</span>
        )}
      </span>
      {props.count === undefined ? null : (
        <Badge tone={props.countTone ?? 'neutral'} aria-hidden="true">
          {props.count}
        </Badge>
      )}
      {props.trailing}
    </>
  )
  const common = {
    className: styles.root,
    onClick: props.onClick,
    'aria-current': props.selected ? ('page' as const) : undefined,
    'data-selected': props.selected ? '' : undefined,
    'data-sub': props.sub ? '' : undefined,
  }
  return props.href ? (
    <a {...common} href={props.href}>
      {content}
    </a>
  ) : (
    <button {...common} type="button">
      {content}
    </button>
  )
}

export namespace NavItem {
  export interface Props {
    children: ReactNode
    icon?: ReactNode
    /** A number after the label; announced with the name. */
    count?: number | string
    /** What the count counts, for the accessible name: "unread" gives "Inbox, 3 unread". */
    countLabel?: string
    /** Accent for work waiting on you (Inbox, Reviews); neutral for the rest (Triage). */
    countTone?: 'neutral' | 'accent'
    /** After the count: a shortcut hint or a status glyph. */
    trailing?: ReactNode
    href?: string
    /** Gets the click event, so a router can `preventDefault` and navigate without a reload. */
    onClick?: MouseEventHandler<HTMLElement>
    selected?: boolean
    /** A sub-item: 28px tall, indented under its parent. */
    sub?: boolean
  }
}
