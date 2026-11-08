import type { MouseEventHandler } from 'react'

import { cx } from './cx.ts'

import styles from './Breadcrumbs.module.css'

/**
 * A breadcrumb trail: a `nav` landmark with an ordered list; every item but the last is a link,
 * the last is plain text marked `aria-current="page"`. The separator is drawn by CSS and
 * silent for screen readers.
 */
export function Breadcrumbs({ items, label = 'Breadcrumb', className }: Breadcrumbs.Props) {
  return (
    <nav aria-label={label} className={cx(styles['root'], className)}>
      <ol className={styles['list']}>
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={item.key ?? `${index}:${item.label}`} className={styles['item']}>
              {last || item.href === undefined ? (
                <span className={styles['current']} aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              ) : (
                <a href={item.href} onClick={item.onClick} className={styles['link']}>
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
    /** For client-side routing: call `preventDefault()` and navigate. */
    onClick?: MouseEventHandler<HTMLAnchorElement>
  }

  export interface Props {
    items: ReadonlyArray<Item>
    /** The landmark's name. */
    label?: string
    className?: string
  }
}
