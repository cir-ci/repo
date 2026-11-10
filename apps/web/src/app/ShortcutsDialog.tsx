import { Dialog } from '@circi/ui'

import { ShortcutGroups } from '#lib/ShortcutGroups.tsx'

/**
 * Every keyboard shortcut, opened with `?`: the same group cards as the Keyboard shortcuts page,
 * two to a row in the wide dialog and one on a phone.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  designEnabled = false,
}: ShortcutsDialog.Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="catalog">
      <ShortcutGroups designEnabled={designEnabled} headingLevel={3} />
    </Dialog>
  )
}

export namespace ShortcutsDialog {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Lists the Design mode key too. */
    designEnabled?: boolean
  }
}
