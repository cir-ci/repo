import { Popover, Text } from '@circi/ui'
import type { ReactNode } from 'react'

import { InstantTextField } from './InstantTextField.tsx'

import styles from './IdentityEditor.module.css'

/**
 * Who or what something is, in one compact row: the avatar (a button that opens a popover with
 * everything about the picture) and the name field right beside it. The name saves on blur and
 * Enter like `InstantTextField`; what the popover holds is up to `panel`. Without `canEdit` it is
 * the avatar and the plain name, nothing to click.
 */
export function IdentityEditor({
  avatar,
  buttonLabel,
  panel,
  panelLabel,
  wide,
  canEdit = true,
  label = 'Name',
  ...field
}: IdentityEditor.Props) {
  if (!canEdit) {
    return (
      <div className={styles.root}>
        <div className={styles.avatar}>{avatar}</div>
        <Text className={styles.plainName}>{field.saved}</Text>
      </div>
    )
  }
  return (
    <div className={styles.root}>
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
      <div className={styles.field}>
        <InstantTextField {...field} label={label} hideLabel size="lg" />
      </div>
    </div>
  )
}

export namespace IdentityEditor {
  export interface Props extends Omit<InstantTextField.Props, 'label' | 'hideLabel' | 'size'> {
    /** The 40 px `Avatar`; it is drawn aria-hidden inside the button. */
    avatar: ReactNode
    /** The button's accessible name: "Change picture", "Change icon and colour". */
    buttonLabel: string
    /** What the popover holds. */
    panel: ReactNode
    /** The popover's accessible name. */
    panelLabel: string
    /** A wide panel (the team's colours and icon grid) instead of a small menu. */
    wide?: boolean
    /** False: the avatar and the name are shown, not editable. */
    canEdit?: boolean
    /** The field's accessible name; "Name". */
    label?: string
  }
}
