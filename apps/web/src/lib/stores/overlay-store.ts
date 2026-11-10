import { create } from 'zustand'

/** The shell's overlays (command menu, shortcuts help, New team, New workspace), opened from the sidebar, the keyboard and pages. */
export const useOverlayStore = create<OverlayStore.State & OverlayStore.Actions>()((set) => ({
  ...initialOverlayState(),
  setCommandMenuOpen: (commandMenuOpen) => set({ commandMenuOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setNewTeamOpen: (newTeamOpen) => set({ newTeamOpen }),
  setNewWorkspaceOpen: (newWorkspaceOpen) => set({ newWorkspaceOpen }),
  setImportWorkspace: (importWorkspace) => set({ importWorkspace }),
  setSettingsNavOpen: (settingsNavOpen) => set({ settingsNavOpen }),
  setMoreOpen: (moreOpen) => set({ moreOpen }),
  reset: () => set(initialOverlayState()),
}))

function initialOverlayState(): OverlayStore.State {
  return {
    commandMenuOpen: false,
    helpOpen: false,
    newTeamOpen: false,
    newWorkspaceOpen: false,
    importWorkspace: null,
    settingsNavOpen: false,
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
    /** The Import from GitHub dialog, opened from the Teams page: the slug of the workspace it imports into, or null while closed. */
    importWorkspace: string | null
    /** The phone's settings sections sheet, opened from the settings page header. */
    settingsNavOpen: boolean
    /** The phone's More sheet (the last tab of the bottom bar). */
    moreOpen: boolean
  }
  export interface Actions {
    setCommandMenuOpen: (open: boolean) => void
    setHelpOpen: (open: boolean) => void
    setNewTeamOpen: (open: boolean) => void
    setNewWorkspaceOpen: (open: boolean) => void
    setImportWorkspace: (workspace: string | null) => void
    setSettingsNavOpen: (open: boolean) => void
    setMoreOpen: (open: boolean) => void
    reset: () => void
  }
}
