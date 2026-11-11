import { create } from 'zustand'

/** The shell's overlays (command menu, shortcuts help, New project, New workspace), opened from the sidebar, the keyboard and pages. */
export const useOverlayStore = create<OverlayStore.State & OverlayStore.Actions>()((set) => ({
  ...initialOverlayState(),
  setCommandMenuOpen: (commandMenuOpen) => set({ commandMenuOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setNewWorkspaceOpen: (newWorkspaceOpen) => set({ newWorkspaceOpen }),
  setImportWorkspace: (importWorkspace) => set({ importWorkspace }),
  setSettingsNavOpen: (settingsNavOpen) => set({ settingsNavOpen }),
  setMoreOpen: (moreOpen) => set({ moreOpen }),
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  setTabsOpen: (tabsOpen) => set({ tabsOpen }),
  reset: () => set(initialOverlayState()),
}))

function initialOverlayState(): OverlayStore.State {
  return {
    commandMenuOpen: false,
    helpOpen: false,
    newProjectOpen: false,
    newWorkspaceOpen: false,
    importWorkspace: null,
    settingsNavOpen: false,
    moreOpen: false,
    projectsOpen: false,
    tabsOpen: false,
  }
}

export namespace OverlayStore {
  export interface State {
    commandMenuOpen: boolean
    helpOpen: boolean
    /** The New project dialog: opened from the sidebar's "+", the empty state and the Projects page. */
    newProjectOpen: boolean
    newWorkspaceOpen: boolean
    /** The Import from GitHub dialog, opened from the Projects page: the slug of the workspace it imports into, or null while closed. */
    importWorkspace: string | null
    /** The phone's settings sections sheet, opened from the settings page header. */
    settingsNavOpen: boolean
    /** The phone's More sheet (the last tab of the bottom bar). */
    moreOpen: boolean
    /** The phone's Projects sheet (the Projects tab of the bottom bar). */
    projectsOpen: boolean
    /** The phone's tab switcher sheet (installed app), opened from the header's tab button. */
    tabsOpen: boolean
  }
  export interface Actions {
    setCommandMenuOpen: (open: boolean) => void
    setHelpOpen: (open: boolean) => void
    setNewProjectOpen: (open: boolean) => void
    setNewWorkspaceOpen: (open: boolean) => void
    setImportWorkspace: (workspace: string | null) => void
    setSettingsNavOpen: (open: boolean) => void
    setMoreOpen: (open: boolean) => void
    setProjectsOpen: (open: boolean) => void
    setTabsOpen: (open: boolean) => void
    reset: () => void
  }
}
