import { Switch } from '@circi/ui'
import { Navigate } from '@tanstack/react-router'

import { Frame } from '#features/workspace-settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ShortcutGroups } from '#lib/ShortcutGroups.tsx'
import { useSingleKeyStore } from '#lib/stores/single-key-store.ts'
import { toast } from '#lib/toast.ts'
import { usePhone } from '#lib/use-phone.ts'

/**
 * Every keyboard shortcut, from the same registry as the `?` dialog: one card per group in a grid
 * that wraps from several columns down to one, under the personal "Single-key shortcuts" switch
 * (instant, kept in this browser; WCAG 2.1.4), and the single-key rows are marked. A phone has no keyboard to speak of: no entry
 * leads here, and an address that does goes to the profile.
 */
export function ShortcutsPage() {
  useDocumentTitle('Keyboard shortcuts')
  const phone = usePhone()
  const enabled = useSingleKeyStore((s) => s.enabled)
  const setEnabled = useSingleKeyStore((s) => s.setEnabled)
  if (phone) return <Navigate to="/account/profile" replace />
  return (
    <Frame crumbs={['Account', 'Keyboard shortcuts']} width="wide">
      <Switch
        label="Single-key shortcuts"
        description="Off: only shortcuts with ⌘ or ⌥ work."
        checked={enabled}
        onCheckedChange={(next) => {
          setEnabled(next)
          toast(`Single-key shortcuts ${next ? 'on' : 'off'}`)
        }}
      />
      <ShortcutGroups focusable markSingleKey />
    </Frame>
  )
}
