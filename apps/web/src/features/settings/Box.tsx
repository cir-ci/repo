import { Text } from '@circi/ui'
import type { ReactNode } from 'react'

import styles from './Settings.module.css'

/** The bordered box a settings section keeps its rows in. `danger` tints the border. */
export function Box({ danger = false, label, children }: Box.Props) {
  return (
    <div
      className={danger ? `${styles.box} ${styles.boxDanger}` : styles.box}
      {...(label ? { role: 'group', 'aria-label': label } : {})}
    >
      {children}
    </div>
  )
}

export namespace Box {
  export interface Props {
    danger?: boolean
    /** Names the group for assistive technology. */
    label?: string
    children: ReactNode
  }
}

/** One row of a `Box`: a title and one line of help on the left, the control on the right. */
export function BoxRow({ title, help, top = false, children }: BoxRow.Props) {
  return (
    <div className={styles.boxRow} {...(top ? { 'data-top': '' } : {})}>
      {title === undefined ? null : (
        <span className={styles.rowText}>
          <Text>{title}</Text>
          {help ? (
            <Text variant="small" tone="tertiary">
              {help}
            </Text>
          ) : null}
        </span>
      )}
      {children}
    </div>
  )
}

export namespace BoxRow {
  export interface Props {
    title?: ReactNode
    help?: ReactNode
    /** Align to the top, for rows with long text. */
    top?: boolean
    children?: ReactNode
  }
}
