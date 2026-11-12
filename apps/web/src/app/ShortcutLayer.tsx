import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'

import { classifyVisit } from '#features/command/recent.ts'
import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useRememberOpenedWorkspace, useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { onDemand } from '#lib/on-demand.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useRecentStore } from '#lib/stores/recent-store.ts'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'
import { useCopy } from '#lib/use-copy.ts'

import { useNavPane } from './NavToggle.tsx'
import { isAppPage } from './settings-return.ts'
import { goPath } from './shell-model.ts'
import { useTabShortcuts } from './use-tab-shortcuts.ts'

const CommandMenu = onDemand(
  () => import('#features/command/CommandMenu.tsx'),
  (m) => m.CommandMenu,
)
const ShortcutsDialog = onDemand(
  () => import('./ShortcutsDialog.tsx'),
  (m) => m.ShortcutsDialog,
)

/**
 * Binds the global shortcuts (G-chords, ⌘K, `?`, ⌘⇧C) once for the signed-in app, and renders the
 * two dialogs they open (their open state is in `useOverlayStore`): the command menu and the shortcuts help.
 */
export function ShortcutLayer({ children }: ShortcutLayer.Props) {
  const router = useRouter()
  const params = useParams({ strict: false })
  const { copy } = useCopy()
  const { workspace, workspaces } = useWorkspaces(useChosenWorkspace())
  useRememberOpenedWorkspace()
  const { data: sidebar } = useSidebarModel(workspace?.slug)
  const { data: caps } = useQuery(capabilitiesQuery())
  const commandOpen = useOverlayStore((s) => s.commandMenuOpen)
  const setCommandOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  const helpOpen = useOverlayStore((s) => s.helpOpen)
  const setHelpOpen = useOverlayStore((s) => s.setHelpOpen)
  const address = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, search: s.location.searchStr }),
  })
  const nav = useNavPane()
  const record = useRecentStore((s) => s.record)
  const noteAppPage = useSettingsReturnStore((s) => s.noteAppPage)

  // Settings' way back: the last page of the app, remembered while the person is on one.
  useEffect(() => {
    if (isAppPage(address.pathname)) noteAppPage(address.pathname + address.search)
  }, [address.pathname, address.search, noteAppPage])

  // Recent: what was visited, per workspace, in this browser only.
  useEffect(() => {
    const visit = classifyVisit(
      address.pathname,
      address.search,
      sidebar?.projects,
      sidebar?.views,
      Date.now(),
    )
    if (visit) record(visit.workspace, visit.entry)
    // The visit is the address; the sidebar's lists only name it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [address.pathname, address.search, sidebar?.projects === undefined])

  useTabShortcuts()
  useShortcutHandlers({
    go: ({ to }) => {
      const path = goPath(to, {
        workspace: workspace?.slug,
        // A project in the address only counts when it belongs to the workspace being shown.
        project: params.workspace === workspace?.slug ? params.project : undefined,
        projects: sidebar?.projects,
        canManage: sidebar?.canManage,
        instanceAdmin: caps?.instanceAdmin,
      })
      if (path) router.history.push(path)
    },
    command: () => setCommandOpen(true),
    help: () => setHelpOpen(true),
    toggleSidebar: nav.toggle,
    copyLink: () => {
      void copy(location.href, 'Link')
    },
  })

  return (
    <>
      {children}
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        workspace={workspace?.slug}
        projects={sidebar?.projects}
        views={sidebar?.views}
        canManage={sidebar?.canManage}
        workspaces={workspaces}
        needs={{
          reviews: sidebar?.reviews ?? 0,
          unread: sidebar?.inboxUnread ?? 0,
          triageAssigned: sidebar?.triageAssigned ?? 0,
        }}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  )
}

export namespace ShortcutLayer {
  export interface Props {
    children: ReactNode
  }
}
