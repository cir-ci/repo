import { Dialog, Kbd, Text } from '@circi/ui'

import { keyCaps, shortcutGroups } from '../../lib/shortcuts.ts'

import styles from './BuildReview.module.css'

/** Every keyboard shortcut, from the registry, opened with `?`. */
export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialog.Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      {shortcutGroups().map(({ group, shortcuts }) => (
        <section key={group} aria-label={group}>
          <Text variant="micro" tone="tertiary">
            {group}
          </Text>
          <dl className={styles['shortcuts']}>
            {shortcuts.map((s) => (
              <div key={s.key} className={styles['shortcut']}>
                <dt className={styles['caps']}>
                  {keyCaps(s.key).map((cap) => (
                    <Kbd key={cap}>{cap}</Kbd>
                  ))}
                </dt>
                <dd>
                  <Text>{s.description}</Text>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Dialog>
  )
}

export namespace ShortcutsDialog {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
  }
}
