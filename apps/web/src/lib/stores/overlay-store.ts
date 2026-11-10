import { create } from 'zustand'

/** The shell's overlays (command menu, shortcuts help, New team, New workspace), opened from the sidebar, the keyboard and pages. */
export const useOverlayStore = create<OverlayStore.State & OverlayStore.Actions>()((set) => ({
  ...initialOverlayState(),
  setCommandMenuOpen: (commandMenuOpen) => set({ commandMenuOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setNewTeamOpen: (newTeamOpen) => set({ newTeamOpen }),
  setNewWorkspaceOpen: (newWorkspaceOpen) => set({ newWorkspaceOpen }),
  setImportOpen: (importOpen) => set({ importOpen }),
  setDrawerAt: (drawerAt) => set({ drawerAt }),
  setMoreOpen: (moreOpen) => set({ moreOpen }),
  reset: () => set(initialOverlayState()),
}))

function initialOverlayState(): OverlayStore.State {
  return {
    commandMenuOpen: false,
    helpOpen: false,
    newTeamOpen: false,
    newWorkspaceOpen: false,
    importOpen: false,
    drawerAt: undefined,
    moreOpen: false,
  }
}

export namespace OverlayStore {
  export interface State {
    commandMenuOpen: boolean
    helpOpen: boolean
    /** The New team dialog: opened from the sidebar's "+", the empty state and the Teams page. */
    newTeamOpen: boolean
    newWorkspaceOpen: boolean
    /** The Import from GitHub dialog, opened from the Teams page. */
    importOpen: boolean
    /**
     * The narrow-screen navigation drawer: the path it is open on, or undefined when closed. It
     * belongs to that page, so choosing another page closes it, unless the choice only expands an
     * entry (a team), which moves it along (`NavLink`'s `expands`).
     */
    drawerAt: string | undefined
    /** The phone's More sheet (the last tab of the bottom bar). */
    moreOpen: boolean
  }
  export interface Actions {
    setCommandMenuOpen: (open: boolean) => void
    setHelpOpen: (open: boolean) => void
    setNewTeamOpen: (open: boolean) => void
    setNewWorkspaceOpen: (open: boolean) => void
    setImportOpen: (open: boolean) => void
    setDrawerAt: (path: string | undefined) => void
    setMoreOpen: (open: boolean) => void
    reset: () => void
  }
}
