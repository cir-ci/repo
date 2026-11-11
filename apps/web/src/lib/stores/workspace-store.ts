import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'

import { readRememberedWorkspace, rememberWorkspace } from '#app/shell-model.ts'
import { capabilitiesQuery } from '#features/projects/api/index.ts'

/**
 * The workspace the person chose in this tab (the switcher's choice), shared by the sidebar, the
 * settings nav, the Projects page and the shortcuts. Also kept in the browser as the fallback for when
 * the account's remembered workspace (on the server) isn't there to read yet.
 */
export const useWorkspaceStore = create<WorkspaceStore.State & WorkspaceStore.Actions>()((set) => ({
  chosen: undefined,
  choose: (slug) => {
    rememberWorkspace(slug)
    set({ chosen: slug })
  },
  reset: () => set({ chosen: undefined }),
}))

/**
 * The slug of the chosen workspace, reactive: the pages that read it follow a switch. Before a
 * choice in this tab: the one the account remembers (any device), else this browser's.
 */
export const useChosenWorkspace = (): string | undefined => {
  const chosen = useWorkspaceStore((s) => s.chosen)
  const { data: caps } = useQuery(capabilitiesQuery())
  return chosen ?? caps?.lastWorkspace ?? readRememberedWorkspace()
}

export namespace WorkspaceStore {
  export interface State {
    /** Set when chosen in this tab; undefined: the account's, else the browser's memory. */
    chosen: string | undefined
  }
  export interface Actions {
    choose: (slug: string) => void
    reset: () => void
  }
}
