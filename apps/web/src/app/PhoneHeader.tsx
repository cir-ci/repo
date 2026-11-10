import { CloseIcon, IconButton, MenuIcon, SearchIcon } from '@circi/ui'
import { useRouter, useRouterState } from '@tanstack/react-router'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import { returnTarget } from './settings-return.ts'
import { currentSection, isSettingsSection } from './shell-model.ts'

/**
 * At the left of the page header on a phone: opens the navigation drawer (the sidebar is not on
 * screen there). The drawer belongs to the page it was opened on (`drawerAt`).
 */
export function OpenNavButton() {
  const phone = usePhone()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const setDrawerAt = useOverlayStore((s) => s.setDrawerAt)
  if (!phone) return null
  return (
    <IconButton label="Open navigation" onClick={() => setDrawerAt(pathname)}>
      <MenuIcon />
    </IconButton>
  )
}

/** At the right of the page header on a phone: search, or in settings the Close that leaves it. */
export function PhoneEnd() {
  const phone = usePhone()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const setCommandMenuOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  if (!phone) return null
  if (isSettingsSection(currentSection(pathname))) return <CloseSettings />
  return (
    <IconButton label="Search" onClick={() => setCommandMenuOpen(true)}>
      <SearchIcon />
    </IconButton>
  )
}

/** Settings is a closed area: its one way out is the page the person came from. */
function CloseSettings() {
  const router = useRouter()
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: sidebar } = useSidebarModel(workspace?.slug)
  const back = returnTarget(
    useSettingsReturnStore((s) => s.app),
    sidebar?.teams,
  )
  return (
    <IconButton
      label={`Close settings, back to ${back.label}`}
      onClick={() => router.history.push(back.path)}
    >
      <CloseIcon />
    </IconButton>
  )
}
