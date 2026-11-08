import type { MouseEventHandler, ReactNode } from 'react'

import styles from './NavItem.module.css'

/** One entry of the sidebar (28px). `selected` marks the current page. */
export function NavItem(props: NavItem.Props) {
  const content = (
    <>
      {props.icon}
      <span className={styles['label']}>{props.children}</span>
      {props.trailing}
    </>
  )
  const common = {
    className: styles['root'],
    onClick: props.onClick,
    'aria-current': props.selected ? ('page' as const) : undefined,
    'data-selected': props.selected ? '' : undefined,
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
    /** After the label: a count, a shortcut hint or a status glyph. */
    trailing?: ReactNode
    href?: string
    /** Gets the click event, so a router can `preventDefault` and navigate without a reload. */
    onClick?: MouseEventHandler<HTMLElement>
    selected?: boolean
  }
}
