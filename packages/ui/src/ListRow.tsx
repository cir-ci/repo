import type { MouseEventHandler, ReactNode } from 'react'

import { cx } from './cx.ts'
import { Text } from './Text.tsx'

import styles from './ListRow.module.css'

/**
 * The one row every list uses (Triage, Builds, Baselines, Reviews, Inbox, settings lists): an optional leading
 * glyph or avatar, a title (13/500) with an optional subtitle (12 tertiary), each cut with an ellipsis, then
 * `children` for anything below, trailing metadata and an optional hover-revealed `action` chip. A row with a
 * subtitle is two-line (56px), otherwise 44px. Becomes a link with `href`, a button with `onClick`, otherwise
 * a plain row.
 */
export function ListRow(props: ListRow.Props) {
  const content = (
    <>
      {props.leading}
      <div className={styles.content}>
        {props.title === undefined ? null : (
          <Text truncate className={styles.title}>
            {props.title}
          </Text>
        )}
        {props.subtitle === undefined ? null : (
          <Text truncate variant="small" tone="tertiary" className={styles.subtitle}>
            {props.subtitle}
          </Text>
        )}
        {props.children}
      </div>
      {props.action ? (
        <span
          className={styles.action}
          aria-hidden="true"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.action?.onAction()
          }}
        >
          {props.action.label}
        </span>
      ) : null}
      {props.trailing}
    </>
  )
  const interactive = Boolean(props.href ?? props.onClick)
  const common = {
    className: cx(styles.root, props.className),
    'aria-current': props.selected ? ('true' as const) : undefined,
    'data-density': props.density ?? (props.subtitle === undefined ? undefined : 'two-line'),
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
    /** The name of the item: one line, 13/500. */
    title?: ReactNode
    /** Secondary line under the title: one line, 12 tertiary. Makes the row two-line. */
    subtitle?: ReactNode
    /** Anything else below the title and subtitle (chips, a custom body). */
    children?: ReactNode
    /** Chip shown on hover, keyboard focus and selection (a shortcut, mouse-only: keep the same action reachable elsewhere). */
    action?: { label: ReactNode; onAction: () => void }
    /** Glyph or avatar before the content. */
    leading?: ReactNode
    /** Metadata after the content: counts, time, author. */
    trailing?: ReactNode
    href?: string
    /** Receives the click: call `preventDefault()` on a link row to navigate client-side. */
    onClick?: MouseEventHandler<HTMLElement>
    selected?: boolean
    /** Row height: compact 32, default 44, two-line 56 (minimum; the default when there is a subtitle). */
    density?: 'compact' | 'default' | 'two-line'
    className?: string
  }
}
