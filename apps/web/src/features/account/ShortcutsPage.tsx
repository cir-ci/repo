import { Kbd, SectionHeader, Text } from '@circi/ui'

import { Frame } from '#features/workspace-settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { keyCaps, shortcutGroups } from '#lib/shortcuts.ts'

import styles from '#features/workspace-settings/Settings.module.css'

/** Every keyboard shortcut, from the same registry as the `?` dialog, grouped. */
export function ShortcutsPage() {
  useDocumentTitle('Keyboard shortcuts')
  return (
    <Frame crumbs={['Account', 'Keyboard shortcuts']}>
      <Text as="p" tone="secondary" className={styles.intro}>
        Press <Kbd>?</Kbd> anywhere to see this list in a dialog.
      </Text>
      {shortcutGroups().map(({ group, shortcuts }) => (
        <section key={group} className={styles.section} aria-label={group}>
          <SectionHeader title={group} />
          <dl className={styles.shortcutGrid}>
            {shortcuts.map((s) => (
              <div key={s.key} className={styles.shortcutRow}>
                <dt>
                  {keyCaps(s.key).map((cap) => (
                    <Kbd key={cap}>{cap}</Kbd>
                  ))}
                </dt>
                <dd>
                  <Text tone="secondary">{s.description}</Text>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Frame>
  )
}
