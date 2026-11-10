import { Navigate } from '@tanstack/react-router'

import { Frame } from '#features/workspace-settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ShortcutGroups } from '#lib/ShortcutGroups.tsx'
import { usePhone } from '#lib/use-phone.ts'

/**
 * Every keyboard shortcut, from the same registry as the `?` dialog: one card per group in a grid
 * that wraps from several columns down to one. A phone has no keyboard to speak of: no entry
 * leads here, and an address that does goes to the profile.
 */
export function ShortcutsPage() {
  useDocumentTitle('Keyboard shortcuts')
  const phone = usePhone()
  if (phone) return <Navigate to="/account/profile" replace />
  return (
    <Frame crumbs={['Account', 'Keyboard shortcuts']} width="wide">
      <ShortcutGroups />
    </Frame>
  )
}
