import type { MouseEventHandler, ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './ListRow.module.css'

/**
 * One dense row of a list (44px by default): optional leading glyph, content that grows, optional trailing
 * metadata. Becomes a link with `href`, a button with `onClick`, otherwise a plain row.
 */
export function ListRow(props: ListRow.Props) {
  const content = (
    <>
      {props.leading}
      <div className={styles['content']}>{props.children}</div>
      {props.trailing}
    </>
  )
  const interactive = Boolean(props.href ?? props.onClick)
  const common = {
    className: cx(styles['root'], props.className),
    'aria-current': props.selected ? ('true' as const) : undefined,
    'data-density': props.density,
    'data-selected': props.selected ? '' : undefined,
    'data-interactive': interactive ? '' : undefined,
  }
  if (props.href) {
    return (
      <a {...common} href={props.href} onClick={props.onClick}>
        {content}
      </a>
    )
  }
  if (props.onClick) {
    return (
      <button {...common} type="button" onClick={props.onClick}>
        {content}
      </button>
    )
  }
  return <div {...common}>{content}</div>
}

export namespace ListRow {
  export interface Props {
    children: ReactNode
    /** Glyph or avatar before the content. */
    leading?: ReactNode
    /** Metadata after the content: counts, time, author. */
    trailing?: ReactNode
    href?: string
    /** Receives the click: call `preventDefault()` on a link row to navigate client-side. */
    onClick?: MouseEventHandler<HTMLElement>
    selected?: boolean
    /** Row height: compact 32, default 44, two-line 56 (minimum). */
    density?: 'compact' | 'default' | 'two-line'
    className?: string
  }
}
