import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'

import styles from './CommandDialog.module.css'

/**
 * The shell of the command menu: a modal near the top of the screen with no header, the
 * command radius and the scrim (under 600px a bottom sheet with a grabber), and room for a search field, a list and a side pane (children).
 * Focus goes to `initialFocus` (the first field inside when left out), Escape closes, and focus returns to what opened it.
 * `label` names the dialog for screen readers; `onClosed` runs once the close has finished (a
 * command that opens another dialog waits for it).
 */
export function CommandDialog({
  onClosed,
  label,
  wide = false,
  initialFocus,
  children,
  ...rest
}: CommandDialog.Props) {
  return (
    <BaseDialog.Root
      {...rest}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.()
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Viewport className={styles.viewport}>
          <BaseDialog.Popup
            className={styles.popup}
            data-wide={wide ? '' : undefined}
            {...(initialFocus === undefined ? {} : { initialFocus })}
          >
            <span className={styles.grabber} aria-hidden="true" />
            <BaseDialog.Title className={styles.hidden}>{label}</BaseDialog.Title>
            {children}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export namespace CommandDialog {
  // `onOpenChangeComplete` is ours (`onClosed`, once the close finished).
  export interface Props extends Omit<BaseDialog.Root.Props, 'children' | 'onOpenChangeComplete'> {
    onClosed?: () => void
    /** The accessible name of the dialog. */
    label: string
    /** 880px instead of 720px, for a side pane that always shows. */
    wide?: boolean
    /** What gets focus when it opens, when the first tabbable element is not the one (a chip before the field). */
    initialFocus?: BaseDialog.Popup.Props['initialFocus']
    children?: ReactNode
  }
}
