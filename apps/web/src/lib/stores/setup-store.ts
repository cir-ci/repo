import { create } from 'zustand'

import type { CreatedProject } from '#features/projects/api/new-project.ts'

/**
 * First-run setup's last step shows the first project's CI token once. The server ends the setup
 * the moment the project exists, so without this the app would replace the page (and the token)
 * before it is copied. While a project is held here the setup page stays; "Done" releases it.
 */
export const useSetupStore = create<SetupStore.State & SetupStore.Actions>()((set) => ({
  project: undefined,
  arriving: false,
  arrive: () => set({ arriving: true }),
  hold: (project) => set({ project }),
  release: () => set({ project: undefined }),
  reset: () => set({ project: undefined, arriving: false }),
}))

export namespace SetupStore {
  export interface State {
    /** The project made in the last step, while its token is on screen. */
    project: CreatedProject | undefined
    /**
     * The account was just made on this page: the next steps are certain to follow, so the app
     * waits for the server's word instead of flashing its frame first.
     */
    arriving: boolean
  }
  export interface Actions {
    arrive: () => void
    hold: (project: CreatedProject) => void
    release: () => void
    reset: () => void
  }
}
