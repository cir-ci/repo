import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react'

import styles from './PanelHeader.module.css'

const NoticesContext = createContext<ReactNode>(null)

/**
 * What a panel's notices are (an invitation, a moved address): the `PanelHeader` of the page
 * shows them right under itself, inside the panel, so they sit below the sticky header and scroll
 * away with the page instead of stacking above it.
 */
export function PanelNotices({ notices, children }: PanelNotices.Props) {
  return <NoticesContext.Provider value={notices}>{children}</NoticesContext.Provider>
}

export namespace PanelNotices {
  export interface Props {
    notices: ReactNode
    children?: ReactNode
  }
}

/**
 * The bar at the top of the content panel (44px, taller where it wraps): where you are on the
 * left, the page's actions on the right. It sticks to the top of the panel while the page
 * scrolls, and gives its height to the panel as `--circi-page-top`, so a page's own sticky parts
 * stop under it.
 */
export function PanelHeader(props: PanelHeader.Props) {
  const ref = useRef<HTMLElement>(null)
  const notices = useContext(NoticesContext)
  useLayoutEffect(() => {
    const header = ref.current
    const panel = header?.parentElement
    if (!header || !panel) return undefined
    const measure = () =>
      panel.style.setProperty(
        '--circi-page-top',
        `calc(var(--circi-window-top, 0px) + ${header.getBoundingClientRect().height}px)`,
      )
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(header)
    return () => {
      observer?.disconnect()
      panel.style.removeProperty('--circi-page-top')
    }
  }, [])
  return (
    <>
      <header ref={ref} className={styles.root} data-panel-header="">
        {props.children}
        <div className={styles.spacer} />
        {props.actions ? <div className={styles.actions}>{props.actions}</div> : null}
      </header>
      {notices}
    </>
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
