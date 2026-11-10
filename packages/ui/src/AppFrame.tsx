import type { CSSProperties, ReactNode } from 'react'

import { useScrollingFlag } from './use-scrolling.ts'

import styles from './AppFrame.module.css'

/**
 * The app frame: a dim chrome (the sidebar and page ground) around one lifted content panel.
 * Below 820px the sidebar stacks above the panel, or, when `compactBar` is given, is replaced by
 * that bar (the app puts a menu button in it that opens the sidebar in a `Drawer`).
 */
export function AppFrame(props: AppFrame.Props) {
  const onNavScroll = useScrollingFlag()
  const height = props.minHeight ?? '100dvh'
  const style: CSSProperties & Record<'--circi-frame-height', string | number> = {
    minHeight: height,
    '--circi-frame-height': height,
  }
  const sidebarStyle: CSSProperties & Record<'--circi-sidebar-width', string> = {
    '--circi-sidebar-width':
      typeof props.sidebarWidth === 'string'
        ? props.sidebarWidth
        : `${props.sidebarWidth ?? 244}px`,
  }
  return (
    <div
      className={styles.root}
      style={style}
      data-compact={props.compactBar ? '' : undefined}
      data-sidebar-collapsed={props.sidebarCollapsed ? '' : undefined}
    >
      {props.compactBar ? <div className={styles.bar}>{props.compactBar}</div> : null}
      <div className={styles.sidebar} style={sidebarStyle}>
        <nav
          className={styles.nav}
          aria-label={props.sidebarLabel ?? 'Main'}
          onScroll={onNavScroll}
        >
          {props.sidebar}
        </nav>
        {props.sidebarCollapsed ? null : props.sidebarHandle}
      </div>
      <main className={styles.main} id="content" tabIndex={-1}>
        {props.children}
      </main>
    </div>
  )
}

export namespace AppFrame {
  export interface Props {
    /** Navigation: workspace switcher, `NavItem`s, project list. */
    sidebar: ReactNode
    /** The sidebar landmark's name; "Main" unless the sidebar is another navigation (Settings). */
    sidebarLabel?: string
    /** The page, usually a `PanelHeader` followed by content. */
    children: ReactNode
    /** Minimum height of the frame; defaults to the full viewport. Set it to embed the frame in a smaller area. */
    minHeight?: number | string
    /**
     * A bar (44px) shown above the panel below 820px; the sidebar is hidden there, so render the
     * same navigation in a `Drawer` opened from the bar. Wider screens ignore it.
     */
    compactBar?: ReactNode
    /**
     * The sidebar's width from 820px up: px, or a CSS length (a `min()` that holds it to a share of the frame; percentages
     * resolve against the frame); 244 by default. Below 820px it is ignored.
     */
    sidebarWidth?: number | string
    /** Hides the sidebar from 820px up (the app shows a button in the page header to bring it back). */
    sidebarCollapsed?: boolean
    /**
     * A `ResizeHandle` for the sidebar (`edge="end"`, `cssVar="--circi-sidebar-width"`,
     * `style={{ left: '100%' }}`). It is hidden below 820px and while the sidebar is collapsed.
     */
    sidebarHandle?: ReactNode
  }
}
