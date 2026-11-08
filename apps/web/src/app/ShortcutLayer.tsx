import { useAnnounce } from '@circi/ui'
import { useParams, useRouter } from '@tanstack/react-router'
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

import { CommandMenu } from '../features/command/CommandMenu.tsx'
import { useSidebarModel } from '../features/sidebar/api.ts'
import { useShortcutHandlers } from '../lib/shortcuts.ts'
import { goPath, readRememberedOrg } from './shell-model.ts'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'
import { useOrgs } from './use-orgs.ts'

interface Callbacks {
  /** Opens the command menu (⌘K, the sidebar's Search). */
  openCommandMenu: () => void
  /** Opens the shortcuts help (`?`). */
  openHelp: () => void
}

const noop = () => {}

const ShortcutLayerContext = createContext<Callbacks>({ openCommandMenu: noop, openHelp: noop })

/** The callbacks the shortcut layer exposes, for the sidebar's Search button. */
export const useShortcutLayer = (): Callbacks => useContext(ShortcutLayerContext)

/**
 * Binds the global shortcuts (G-chords, ⌘K, `?`, ⌘⇧C) once for the signed-in app, and owns the
 * two dialogs they open: the command menu and the shortcuts help.
 */
export function ShortcutLayer({ children }: ShortcutLayer.Props) {
  const router = useRouter()
  const params = useParams({ strict: false })
  const announce = useAnnounce()
  const { org } = useOrgs(readRememberedOrg())
  const { data: sidebar } = useSidebarModel(org?.slug)
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const openCommandMenu = () => setCommandOpen(true)
  const openHelp = () => setHelpOpen(true)

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
    command: openCommandMenu,
    help: openHelp,
    copyLink: () => {
      navigator.clipboard.writeText(location.href).then(
        () => announce('Link copied'),
        () => announce('Could not copy the link'),
      )
    },
  })

  const callbacks = useMemo(
    () => ({ openCommandMenu: () => setCommandOpen(true), openHelp: () => setHelpOpen(true) }),
    [],
  )
  return (
    <ShortcutLayerContext value={callbacks}>
      {children}
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        org={org?.slug}
        projects={sidebar?.projects}
        views={sidebar?.views}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </ShortcutLayerContext>
  )
}

export namespace ShortcutLayer {
  export interface Props {
    children: ReactNode
  }
}
