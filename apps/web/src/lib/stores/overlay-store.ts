import { create } from 'zustand'

/** The shell's two overlays, opened from the sidebar, the keyboard and the command menu itself. */
export const useOverlayStore = create<OverlayStore.State & OverlayStore.Actions>()((set) => ({
  ...initialOverlayState(),
  setCommandMenuOpen: (commandMenuOpen) => set({ commandMenuOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  reset: () => set(initialOverlayState()),
}))

function initialOverlayState(): OverlayStore.State {
  return { commandMenuOpen: false, helpOpen: false }
}

export namespace OverlayStore {
  export interface State {
    commandMenuOpen: boolean
    helpOpen: boolean
  }
  export interface Actions {
    setCommandMenuOpen: (open: boolean) => void
    setHelpOpen: (open: boolean) => void
    reset: () => void
  }
}
