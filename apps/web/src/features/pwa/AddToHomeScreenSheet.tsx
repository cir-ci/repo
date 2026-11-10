import { Button, Dialog } from '@circi/ui'

import { usePwaStore } from '#lib/stores/pwa-store.ts'

import styles from './Pwa.module.css'

/**
 * The steps to add CirCI to an iPhone's Home Screen, which has no install prompt. Push works only
 * from there, so the last step says to turn notifications on from the installed app. Opened by the
 * install banner, the account menu's Install app and the notification settings; rendered once
 * in the shell.
 */
export function AddToHomeScreenSheet() {
  const open = usePwaStore((s) => s.sheetOpen)
  const setOpen = usePwaStore((s) => s.setSheetOpen)
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Add CirCI to your Home Screen"
      actions={
        <Button variant="primary" onClick={() => setOpen(false)}>
          Done
        </Button>
      }
    >
      <ol className={styles.steps}>
        <li className={styles.step}>Tap Share in the Safari toolbar</li>
        <li className={styles.step}>Choose Add to Home Screen</li>
        <li className={styles.step}>Open CirCI from the Home Screen, then turn on notifications</li>
      </ol>
    </Dialog>
  )
}
