import { useAnnounce } from '@circi/ui'
import { useParams, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { CommandMenu } from '#features/command/CommandMenu.tsx'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'
import { useCopy } from '#lib/use-copy.ts'

import { goPath } from './shell-model.ts'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'

/**
 * Binds the global shortcuts (G-chords, ⌘K, `?`, ⌘⇧C) once for the signed-in app, and renders the
 * two dialogs they open (their open state is in `useOverlayStore`): the command menu and the shortcuts help.
 */
export function ShortcutLayer({ children }: ShortcutLayer.Props) {
  const router = useRouter()
  const params = useParams({ strict: false })
  const announce = useAnnounce()
  const { copy } = useCopy()
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: sidebar } = useSidebarModel(workspace?.slug)
  const commandOpen = useOverlayStore((s) => s.commandMenuOpen)
  const setCommandOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  const helpOpen = useOverlayStore((s) => s.helpOpen)
  const setHelpOpen = useOverlayStore((s) => s.setHelpOpen)

  useShortcutHandlers({
    go: ({ to }) => {
      const path = goPath(to, {
        workspace: workspace?.slug,
        // A team in the address only counts when it belongs to the workspace being shown.
        team: params.workspace === workspace?.slug ? params.team : undefined,
        teams: sidebar?.teams,
      })
      if (path) router.history.push(path)
    },
    command: () => setCommandOpen(true),
    help: () => setHelpOpen(true),
    copyLink: () => {
      void copy(location.href).then((ok) =>
        announce(ok ? 'Link copied' : 'Could not copy the link'),
      )
    },
  })

  return (
    <>
      {children}
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        workspace={workspace?.slug}
        teams={sidebar?.teams}
        views={sidebar?.views}
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
