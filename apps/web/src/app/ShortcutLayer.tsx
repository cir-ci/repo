import { useAnnounce } from '@circi/ui'
import { useParams, useRouter } from '@tanstack/react-router'
import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { useSidebarModel } from '../features/sidebar/api.ts'
import { useShortcutHandlers } from '../lib/shortcuts.ts'
import { goPath, readRememberedOrg } from './shell-model.ts'
import { useOrgs } from './use-orgs.ts'

const noop = () => {}

interface Callbacks {
  /** Opens the command menu (⌘K, the sidebar's Search). A placeholder until the menu exists (C5). */
  openCommandMenu: () => void
  /** Opens the shortcuts help (`?`). A placeholder until the dialog is global (C5). */
  openHelp: () => void
}

const ShortcutLayerContext = createContext<Callbacks>({ openCommandMenu: noop, openHelp: noop })

/** The callbacks the shortcut layer exposes, for the sidebar's Search button and later the menu itself. */
export const useShortcutLayer = (): Callbacks => useContext(ShortcutLayerContext)

/**
 * Binds the global shortcuts (G-chords, ⌘K, `?`, ⌘⇧C) once for the signed-in app. The command menu
 * and help dialog are not built yet: pass their openers as `openCommandMenu` / `openHelp` when
 * they are (C5); until then those keys do nothing.
 */
export function ShortcutLayer({
  openCommandMenu = noop,
  openHelp = noop,
  children,
}: ShortcutLayer.Props) {
  const router = useRouter()
  const params = useParams({ strict: false })
  const announce = useAnnounce()
  const { org } = useOrgs(readRememberedOrg())
  const { data: sidebar } = useSidebarModel(org?.slug)

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

  const callbacks = useMemo(() => ({ openCommandMenu, openHelp }), [openCommandMenu, openHelp])
  return <ShortcutLayerContext value={callbacks}>{children}</ShortcutLayerContext>
}

export namespace ShortcutLayer {
  export interface Props {
    openCommandMenu?: () => void
    openHelp?: () => void
    children: ReactNode
  }
}
