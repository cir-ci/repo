import { Dialog, Text } from '@circi/ui'

import { ShortcutGroups } from '#lib/ShortcutGroups.tsx'

/**
 * Every keyboard shortcut, opened with `?`: the same group cards as the Keyboard shortcuts page,
 * two to a row in the wide dialog and one on a phone.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  designEnabled = false,
  imageDrag = false,
}: ShortcutsDialog.Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="catalog">
      <ShortcutGroups designEnabled={designEnabled} headingLevel={3} />
      {imageDrag ? (
        <Text as="p" tone="secondary">
          Drag on an image: comment on a region
        </Text>
      ) : null}
    </Dialog>
  )
}

export namespace ShortcutsDialog {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Lists the Design mode key too. */
    designEnabled?: boolean
    /** The build page: add the gesture of dragging on an image, which has no key. */
    imageDrag?: boolean
  }
}
