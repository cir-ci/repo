import { create } from 'zustand'

export const SETTINGS_RETURN_KEY = 'circi-settings-return'

function read(): string | undefined {
  try {
    return sessionStorage.getItem(SETTINGS_RETURN_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function write(path: string): void {
  try {
    sessionStorage.setItem(SETTINGS_RETURN_KEY, path)
  } catch {
    // Storage blocked: the way back lasts until the page reloads.
  }
}

/**
 * The last page of the app (not of settings) this tab was on. Settings is a closed area with one
 * way out, and that way goes back to where the person came from. It is kept per tab
 * (`sessionStorage`), so a reload inside settings still knows it. Empty until the person has seen
 * an app page: the way back then falls to the Inbox (see `returnTarget`).
 */
export const useSettingsReturnStore = create<
  SettingsReturnStore.State & SettingsReturnStore.Actions
>()((set) => ({
  app: read(),
  noteAppPage: (path) => {
    write(path)
    set({ app: path })
  },
  reset: () => set({ app: read() }),
}))

export namespace SettingsReturnStore {
  export interface State {
    /** The path and query of the last app page. */
    app: string | undefined
  }
  export interface Actions {
    noteAppPage: (path: string) => void
    reset: () => void
  }
}
