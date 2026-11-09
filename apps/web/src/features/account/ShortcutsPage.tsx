import { Kbd, SettingsRow, SettingsSection, Text } from '@circi/ui'

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
        <SettingsSection key={group} title={group}>
          {shortcuts.map((s) => (
            <SettingsRow key={s.key} label={s.description}>
              <span className={styles.keys}>
                {keyCaps(s.key).map((cap) => (
                  <Kbd key={cap}>{cap}</Kbd>
                ))}
              </span>
            </SettingsRow>
          ))}
        </SettingsSection>
      ))}
    </Frame>
  )
}
