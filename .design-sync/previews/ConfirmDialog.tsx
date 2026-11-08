import { ConfirmDialog } from '@circi/ui'

/** Open over the card (the dialog is a portal: it follows the page's scheme, not the wrapper). */
export const Typed = () => (
  <ConfirmDialog
    open
    onOpenChange={() => {}}
    title="Delete web-app?"
    description="All builds, baselines and sites of this project are deleted. This can’t be undone."
    confirmText="web-app"
    onConfirm={() => {}}
  />
)
