import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { PanelSlotContext } from './panel-slot.ts'

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
 * left, the page's actions on the right. In an `AppFrame` it is drawn above the panel's scrolling
 * area (a portal into the frame's fixed head), so the scrollbar starts under it and it never
 * moves; its height (and the tab row's) goes to the panel as `--circi-panel-top`, for what a page
 * sizes against the scroller's height. Anything of a page that sticks does so at the scroller's
 * top (`--circi-page-top`, 0).
 */
export function PanelHeader(props: PanelHeader.Props) {
  const ref = useRef<HTMLElement>(null)
  const notices = useContext(NoticesContext)
  const slot = useContext(PanelSlotContext)
  useLayoutEffect(() => {
    // The header exists once the frame's head does (`slot`).
    const header = slot === null ? null : ref.current
    const panel = header?.closest<HTMLElement>('[data-panel]')
    if (!header || !panel) return undefined
    const measure = () =>
      panel.style.setProperty(
        '--circi-panel-top',
        `calc(var(--circi-window-top, 0px) + ${header.getBoundingClientRect().height}px)`,
      )
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(header)
    return () => {
      observer?.disconnect()
      panel.style.removeProperty('--circi-panel-top')
    }
  }, [slot])
  const header = (
    <header ref={ref} className={styles.root} data-panel-header="">
      {props.children}
      <div className={styles.spacer} />
      {props.actions ? <div className={styles.actions}>{props.actions}</div> : null}
    </header>
  )
  return (
    <>
      {slot === undefined ? header : slot ? createPortal(header, slot) : null}
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
