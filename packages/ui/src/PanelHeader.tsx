import type { ReactNode } from 'react'

import styles from './PanelHeader.module.css'

/** The 44px bar at the top of the content panel: where you are on the left, the page's actions on the right. */
export function PanelHeader(props: PanelHeader.Props) {
  return (
    <header className={styles.root}>
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
