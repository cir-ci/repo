import { Kbd, Text } from '@circi/ui'

import { Frame } from '#features/workspace-settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { keyCaps, shortcutGroups } from '#lib/shortcuts.ts'

import styles from './ShortcutsPage.module.css'

/**
 * Every keyboard shortcut, from the same registry as the `?` dialog: one card per group in a grid
 * that wraps from several columns down to one.
 */
export function ShortcutsPage() {
  useDocumentTitle('Keyboard shortcuts')
  return (
    <Frame crumbs={['Account', 'Keyboard shortcuts']} width="wide">
      <Text as="p" tone="secondary" className={styles.intro}>
        Press <Kbd>?</Kbd> anywhere to see this list in a dialog.
      </Text>
      <div className={styles.grid}>
        {shortcutGroups().map(({ group, shortcuts }) => {
          const id = `shortcuts-${group.toLowerCase().replaceAll(' ', '-')}`
          return (
            <section key={group} className={styles.card} aria-labelledby={id}>
              <h2 id={id} className={styles.title}>
                {group}
              </h2>
              <dl className={styles.rows}>
                {shortcuts.map((s) => (
                  <div key={s.key} className={styles.row}>
                    <dt className={styles.action}>{s.description}</dt>
                    <dd className={styles.keys}>
                      {keyCaps(s.key).map((cap) => (
                        <Kbd key={cap}>{cap}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>
    </Frame>
  )
}
