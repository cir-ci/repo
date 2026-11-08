import { useAnnounce } from '@circi/ui'
import { useParams, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { CommandMenu } from '#features/command/CommandMenu.tsx'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import { goPath, readRememberedOrg } from './shell-model.ts'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'
import { useOrgs } from './use-orgs.ts'

/**
 * Binds the global shortcuts (G-chords, ⌘K, `?`, ⌘⇧C) once for the signed-in app, and renders the
 * two dialogs they open (their open state is in `useOverlayStore`): the command menu and the shortcuts help.
 */
export function ShortcutLayer({ children }: ShortcutLayer.Props) {
  const router = useRouter()
  const params = useParams({ strict: false })
  const announce = useAnnounce()
  const { org } = useOrgs(readRememberedOrg())
  const { data: sidebar } = useSidebarModel(org?.slug)
  const commandOpen = useOverlayStore((s) => s.commandMenuOpen)
  const setCommandOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  const helpOpen = useOverlayStore((s) => s.helpOpen)
  const setHelpOpen = useOverlayStore((s) => s.setHelpOpen)

  useShortcutHandlers({
    go: ({ to }) => {
      const path = goPath(to, {
        org: org?.slug,
        // A project in the address only counts when it belongs to the organization being shown.
        project: params.org === org?.slug ? params.project : undefined,
        projects: sidebar?.projects,
      })
      if (path) router.history.push(path)
    },
    command: () => setCommandOpen(true),
    help: () => setHelpOpen(true),
    copyLink: () => {
      navigator.clipboard.writeText(location.href).then(
        () => announce('Link copied'),
        () => announce('Could not copy the link'),
      )
    },
  })

  return (
    <>
      {children}
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        org={org?.slug}
        projects={sidebar?.projects}
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
