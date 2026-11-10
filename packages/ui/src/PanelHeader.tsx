import { useLayoutEffect, useRef, type ReactNode } from 'react'

import styles from './PanelHeader.module.css'

/**
 * The bar at the top of the content panel (44px, taller where it wraps): where you are on the
 * left, the page's actions on the right. It sticks to the top of the window while the page
 * scrolls, and gives its height to the panel as `--circi-page-top`, so a page's own sticky parts
 * stop under it.
 */
export function PanelHeader(props: PanelHeader.Props) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const header = ref.current
    const panel = header?.parentElement
    if (!header || !panel) return undefined
    const measure = () =>
      panel.style.setProperty('--circi-page-top', `${header.getBoundingClientRect().height}px`)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(header)
    return () => {
      observer?.disconnect()
      panel.style.removeProperty('--circi-page-top')
    }
  }, [])
  return (
    <header ref={ref} className={styles.root}>
      {props.children}
      <div className={styles.spacer} />
      {props.actions}
    </header>
  )
}

export namespace PanelHeader {
  export interface Props {
    /** Breadcrumb or page title. */
    children: ReactNode
    /** Buttons for this page's main actions. */
    actions?: ReactNode
  }
}
