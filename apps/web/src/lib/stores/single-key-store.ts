import { create } from 'zustand'

export const SINGLE_KEY_KEY = 'circi-single-key-shortcuts'

/** On unless the stored value says off: a missing, blocked or odd value keeps the shortcuts on. */
function read(): boolean {
  try {
    return localStorage.getItem(SINGLE_KEY_KEY) !== 'off'
  } catch {
    return true
  }
}

function write(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(SINGLE_KEY_KEY)
    else localStorage.setItem(SINGLE_KEY_KEY, 'off')
  } catch {
    // Storage blocked (a private window): the choice lasts until the page reloads.
  }
}

/**
 * Whether single-key shortcuts (a letter, digit or punctuation key, alone or with Shift) work: a
 * personal preference (WCAG 2.1.4), on by default. Kept in this browser only, like the theme.
 */
export const useSingleKeyStore = create<SingleKeyStore.State & SingleKeyStore.Actions>()((set) => ({
  enabled: read(),
  setEnabled: (enabled) => {
    set({ enabled })
    write(enabled)
  },
  reset: () => set({ enabled: read() }),
}))

export namespace SingleKeyStore {
  export interface State {
    enabled: boolean
  }
  export interface Actions {
    setEnabled: (enabled: boolean) => void
    /** Reads the browser's storage again (tests clear it first). */
    reset: () => void
  }
}
