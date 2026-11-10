import { Kbd, Text } from '@circi/ui'

import { Frame } from '#features/workspace-settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ShortcutGroups } from '#lib/ShortcutGroups.tsx'

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
      <ShortcutGroups />
    </Frame>
  )
}
