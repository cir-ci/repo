import type { CSSProperties, ReactNode } from 'react'

import styles from './AppFrame.module.css'

/**
 * The app frame: a dim chrome (the sidebar and page ground) around one lifted content panel.
 * Below 820px the sidebar stacks above the panel, or, when `compactBar` is given, is replaced by
 * that bar (the app puts a menu button in it that opens the sidebar in a `Drawer`).
 */
export function AppFrame(props: AppFrame.Props) {
  const height = props.minHeight ?? '100vh'
  const style: CSSProperties & Record<'--circi-frame-height', string | number> = {
    minHeight: height,
    '--circi-frame-height': height,
  }
  return (
    <div className={styles.root} style={style} data-compact={props.compactBar ? '' : undefined}>
      {props.compactBar ? <div className={styles.bar}>{props.compactBar}</div> : null}
      <nav className={styles.sidebar} aria-label={props.sidebarLabel ?? 'Main'}>
        {props.sidebar}
      </nav>
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
  }
}
