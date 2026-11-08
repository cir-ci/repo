import { Dialog, Kbd, Text } from '@circi/ui'

import { SHORTCUTS } from './shortcuts.ts'

import styles from './BuildReview.module.css'

/** The review screen's keyboard shortcuts, opened with `?`. */
export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialog.Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <dl className={styles['shortcuts']}>
        {SHORTCUTS.map((s) => (
          <div key={s.key} className={styles['shortcut']}>
            <dt>
              <Kbd>{s.key}</Kbd>
            </dt>
            <dd>
              <Text>{s.description}</Text>
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}

export namespace ShortcutsDialog {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
  }
}
