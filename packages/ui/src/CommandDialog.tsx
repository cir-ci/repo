import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'

import styles from './CommandDialog.module.css'

/**
 * The shell of the command menu: a modal near the top of the screen with no header, the
 * command radius and the scrim, and room for a search field, a list and a side pane (children).
 * Focus goes to the first field inside, Escape closes, and focus returns to what opened it.
 * `label` names the dialog for screen readers; `onClosed` runs once the close has finished (a
 * command that opens another dialog waits for it).
 */
export function CommandDialog({
  open,
  onOpenChange,
  onClosed,
  label,
  children,
}: CommandDialog.Props) {
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.()
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Viewport className={styles.viewport}>
          <BaseDialog.Popup className={styles.popup}>
            <BaseDialog.Title className={styles.hidden}>{label}</BaseDialog.Title>
            {children}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export namespace CommandDialog {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    onClosed?: () => void
    /** The accessible name of the dialog. */
    label: string
    children?: ReactNode
  }
}
