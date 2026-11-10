import { CloseIcon, IconButton, SearchIcon, SlidersIcon } from '@circi/ui'
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
 * At the right of the page header on a phone: search, or in settings the sections button (the
 * settings pages, in a sheet) and the Close that leaves them. There is no menu button: the bottom
 * tabs are the phone's navigation.
 */
export function PhoneEnd() {
  const phone = usePhone()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const setCommandMenuOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  if (!phone) return null
  if (isSettingsSection(currentSection(pathname)))
    return (
      <>
        <SettingsSectionsButton />
        <CloseSettings />
      </>
    )
  return (
    <IconButton label="Search" onClick={() => setCommandMenuOpen(true)}>
      <SearchIcon />
    </IconButton>
  )
}

/** Opens the sheet that lists the settings pages (`SettingsSections`). */
function SettingsSectionsButton() {
  const setOpen = useOverlayStore((s) => s.setSettingsNavOpen)
  return (
    <IconButton label="Settings sections" onClick={() => setOpen(true)}>
      <SlidersIcon />
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
