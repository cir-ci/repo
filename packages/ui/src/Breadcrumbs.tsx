import type { MouseEventHandler } from 'react'

import { cx } from './cx.ts'
import { Tooltip } from './Tooltip.tsx'

import styles from './Breadcrumbs.module.css'

/**
 * A breadcrumb trail: a `nav` landmark with an ordered list; every item but the last is a link,
 * the last is plain text marked `aria-current="page"`. The separator is a chevron icon,
 * hidden from screen readers.
 */
export function Breadcrumbs({
  items,
  label = 'Breadcrumb',
  currentIsHeading = false,
  className,
}: Breadcrumbs.Props) {
  return (
    <nav aria-label={label} className={cx(styles.root, className)}>
      <ol className={styles.list}>
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={item.key ?? `${index}:${item.label}`} className={styles.item}>
              {index > 0 ? (
                <svg
                  className={styles.separator}
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  data-separator=""
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              ) : null}
              {last && currentIsHeading ? (
                <h1 className={styles.current} aria-current="page">
                  {item.label}
                </h1>
              ) : last || item.href === undefined ? (
                <span className={styles.current} aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              ) : item.tooltip ? (
                <Tooltip content={item.tooltip}>
                  <a href={item.href} onClick={item.onClick} className={styles.link}>
                    {item.label}
                  </a>
                </Tooltip>
              ) : (
                <a href={item.href} onClick={item.onClick} className={styles.link}>
                  {item.label}
                </a>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export namespace Breadcrumbs {
  export interface Item {
    label: string
    /** Identity of the crumb when labels may repeat; defaults to its position and label. */
    key?: string
    /** Omit on the last item (and on a level that has no page of its own). */
    href?: string
    /** Names the link's target on hover or focus ("Workspace: opens the Inbox"); only on a link. */
    tooltip?: string
    /** For client-side routing: call `preventDefault()` and navigate. */
    onClick?: MouseEventHandler<HTMLAnchorElement>
  }

  export interface Props {
    items: ReadonlyArray<Item>
    /** The landmark's name. */
    label?: string
    /** The current (last) crumb is the page's `<h1>`: every page's title is its breadcrumb. */
    currentIsHeading?: boolean
    className?: string
  }
}
