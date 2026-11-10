import { create } from 'zustand'

import { readRememberedWorkspace, rememberWorkspace } from '#app/shell-model.ts'

/**
 * The workspace the person chose last (the switcher's choice), shared by the sidebar, the settings
 * nav, the Teams page and the shortcuts. Also kept in the browser, so it survives a reload; until
 * someone chooses in this tab, what the browser remembered stands.
 */
export const useWorkspaceStore = create<WorkspaceStore.State & WorkspaceStore.Actions>()((set) => ({
  chosen: undefined,
  choose: (slug) => {
    rememberWorkspace(slug)
    set({ chosen: slug })
  },
  reset: () => set({ chosen: undefined }),
}))

/** The slug of the chosen workspace, reactive: the pages that read it follow a switch. */
export const useChosenWorkspace = (): string | undefined =>
  useWorkspaceStore((s) => s.chosen) ?? readRememberedWorkspace()

export namespace WorkspaceStore {
  export interface State {
    /** Set when chosen in this tab; undefined: read the browser's memory. */
    chosen: string | undefined
  }
  export interface Actions {
    choose: (slug: string) => void
    reset: () => void
  }
}
