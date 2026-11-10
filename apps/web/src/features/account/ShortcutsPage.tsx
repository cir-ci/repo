import { Frame } from '#features/workspace-settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ShortcutGroups } from '#lib/ShortcutGroups.tsx'

/**
 * Every keyboard shortcut, from the same registry as the `?` dialog: one card per group in a grid
 * that wraps from several columns down to one.
 */
export function ShortcutsPage() {
  useDocumentTitle('Keyboard shortcuts')
  return (
    <Frame crumbs={['Account', 'Keyboard shortcuts']} width="wide">
      <ShortcutGroups />
    </Frame>
  )
}
