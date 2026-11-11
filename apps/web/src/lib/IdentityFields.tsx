import { Popover } from '@circi/ui'
import type { ReactNode } from 'react'

import styles from './IdentityFields.module.css'

/**
 * The picture and the fields about who or what something is, in one row: the avatar (a button that
 * opens a popover with everything about the picture) and the fields beside it, each `CheckedTextField`
 * confirming with its own ✓. The fields wrap under each other when the row is narrow. Without
 * `canEdit` the avatar is not a button.
 */
export function IdentityFields({
  avatar,
  buttonLabel,
  panel,
  panelLabel,
  wide,
  canEdit = true,
  children,
}: IdentityFields.Props) {
  return (
    <div className={styles.root}>
      {canEdit ? (
        <Popover
          label={panelLabel}
          className={wide ? styles.wide : styles.narrow}
          trigger={
            <button type="button" className={styles.trigger} aria-label={buttonLabel}>
              {avatar}
            </button>
          }
        >
          {panel}
        </Popover>
      ) : (
        <div className={styles.avatar}>{avatar}</div>
      )}
      <div className={styles.fields}>{children}</div>
    </div>
  )
}

export namespace IdentityFields {
  export interface Props {
    /** The 40 px `Avatar`; it is drawn aria-hidden inside the button. */
    avatar: ReactNode
    /** The button's accessible name: "Change picture". */
    buttonLabel: string
    /** What the popover holds. */
    panel: ReactNode
    /** The popover's accessible name. */
    panelLabel: string
    /** A wide panel instead of a small menu. */
    wide?: boolean
    /** False: the avatar is shown, not a button. */
    canEdit?: boolean
    /** The fields: `CheckedTextField`s (and read-only `TextField`s). */
    children: ReactNode
  }
}
