import { type MouseEventHandler, type RefObject, useLayoutEffect, useRef, useState } from 'react'

import { cx } from './cx.ts'
import { Menu } from './Menu.tsx'
import { Tooltip } from './Tooltip.tsx'

import styles from './Breadcrumbs.module.css'

/**
 * A breadcrumb trail: a `nav` landmark with an ordered list; every item but the last is a link,
 * the last is plain text marked `aria-current="page"`. The separator is a chevron icon,
 * hidden from screen readers. When the trail doesn't fit its room, the middle crumbs (then the
 * first) collapse into a "…" menu of links, so the current crumb stays whole and no crumb is
 * squeezed to nothing.
 */
export function Breadcrumbs({
  items,
  label = 'Breadcrumb',
  currentIsHeading = false,
  className,
}: Breadcrumbs.Props) {
  const { navRef, listRef, collapsed } = useCollapse(items)
  const firstCollapsed = collapsed.length > 0 ? Math.min(...collapsed) : -1
  return (
    <nav ref={navRef} aria-label={label} className={cx(styles.root, className)}>
      <ol ref={listRef} className={styles.list}>
        {items.map((item, index) => {
          const last = index === items.length - 1
          if (collapsed.includes(index)) {
            if (index !== firstCollapsed) return null
            return (
              <li key="collapsed" className={styles.item}>
                {index > 0 ? <Separator /> : null}
                <Menu
                  trigger={
                    <button type="button" className={styles.more} aria-label="Earlier pages">
                      …
                    </button>
                  }
                  items={collapsed
                    .toSorted((a, b) => a - b)
                    .map((at) => menuItem(items[at] ?? item))}
                />
              </li>
            )
          }
          return (
            <li
              key={item.key ?? `${index}:${item.label}`}
              className={styles.item}
              data-current={last ? '' : undefined}
            >
              {index > 0 ? <Separator /> : null}
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

function Separator() {
  return (
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
  )
}

function menuItem(item: Breadcrumbs.Item): Menu.Item {
  return {
    label: item.label,
    ...(item.href === undefined ? {} : { href: item.href }),
    ...(item.onClick ? { onLinkClick: item.onClick } : {}),
  }
}

/**
 * Which crumbs are collapsed into the "…" menu: none while the trail fits its room; otherwise one
 * more at a time (the second, the third, … up to the one before the current, then the first)
 * until the list neither overflows nor cuts the current crumb. Measured before paint; the count
 * starts over when the crumbs or the room change.
 */
function useCollapse(items: ReadonlyArray<Breadcrumbs.Item>): {
  navRef: RefObject<HTMLElement | null>
  listRef: RefObject<HTMLOListElement | null>
  collapsed: number[]
} {
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [room, setRoom] = useState(0)
  const signature = `${items.map((item) => item.label).join('\u0000')}@${room}`
  const [state, setState] = useState({ signature, hidden: 0 })
  const hidden = state.signature === signature ? state.hidden : 0
  // The order crumbs give way: from the second on, the first last; the current one never.
  const order = [...items.keys()].slice(1, -1).concat(items.length > 1 ? [0] : [])

  useLayoutEffect(() => {
    // The header's width is what changes with the window; the nav's own width changes with what
    // is collapsed, so it can't be the trigger.
    const parent = navRef.current?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return undefined
    const resize = new ResizeObserver(() => {
      setRoom(Math.round(parent.getBoundingClientRect().width))
    })
    resize.observe(parent)
    return () => {
      resize.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || hidden >= order.length) return
    const current = list.querySelector<HTMLElement>('[data-current] > [aria-current]')
    const cut = current ? current.scrollWidth > current.clientWidth : false
    if (list.scrollWidth > list.clientWidth || cut) setState({ signature, hidden: hidden + 1 })
  }, [hidden, signature, order.length])

  return { navRef, listRef, collapsed: order.slice(0, hidden) }
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
