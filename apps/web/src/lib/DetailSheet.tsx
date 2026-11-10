import { Sheet } from '@circi/ui'
import type { ReactNode } from 'react'

/**
 * A list page's detail pane on a phone (canvas: Phone, lists): instead of a split beside the list,
 * the pane opens as a sheet over it, and its Close (or a tap outside) goes back to the list. Pass
 * the pane with `bare` so the sheet is its frame. Only render it on a phone (`usePhone`).
 */
export function DetailSheet({ open, onClose, label, children }: DetailSheet.Props) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={label}
      hideTitle
      size="tall"
    >
      {children}
    </Sheet>
  )
}

export namespace DetailSheet {
  export interface Props {
    open: boolean
    onClose: () => void
    /** The sheet's accessible name ("Notification"). */
    label: string
    children: ReactNode
  }
}

/**
 * Where a list page puts its detail pane: beside the list with its resize `handle` from 820px up,
 * a `DetailSheet` over it on a phone. Render it only while something is selected.
 */
export function PaneSlot({ phone, open, onClose, label, handle, children }: PaneSlot.Props) {
  if (!phone) {
    return (
      <>
        {handle}
        {children}
      </>
    )
  }
  return (
    <DetailSheet open={open} onClose={onClose} label={label}>
      {children}
    </DetailSheet>
  )
}

export namespace PaneSlot {
  export interface Props extends DetailSheet.Props {
    phone: boolean
    /** The pane's resize handle, shown beside the pane when not a phone. */
    handle: ReactNode
  }
}
