import { Button, useAnnounce } from '@circi/ui'
import { useEffect } from 'react'

import { useUndoStore } from '#lib/stores/undo-store.ts'

import styles from './UndoToasts.module.css'

/**
 * The toast at the foot of the page for what the command menu just did (`Approved build #148`),
 * with Undo while the change can still be taken back. A screen reader hears the message once,
 * through the announcer; the toast itself is not a live region.
 */
export function UndoToasts() {
  const toast = useUndoStore((s) => s.toast)
  const undo = useUndoStore((s) => s.undo)
  const announce = useAnnounce()
  const id = toast?.id
  const message = toast?.message

  useEffect(() => {
    if (message) announce(message)
    // The announcer function is stable; a new toast (a new id) is what is announced.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!toast) return null
  return (
    <div
      role="group"
      aria-label="Last change"
      className={styles.toast}
      data-undoable={toast.undoable ? '' : undefined}
    >
      <span>{toast.message}</span>
      {toast.undoable ? (
        <Button size="sm" variant="secondary" onClick={undo}>
          Undo
        </Button>
      ) : null}
    </div>
  )
}
