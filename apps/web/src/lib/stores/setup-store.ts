import { create } from 'zustand'

import type { CreatedTeam } from '#features/teams/api/new-team.ts'

/**
 * First-run setup's last step shows the first team's CI token once. The server ends the setup
 * the moment the team exists, so without this the app would replace the page (and the token)
 * before it is copied. While a team is held here the setup page stays; "Done" releases it.
 */
export const useSetupStore = create<SetupStore.State & SetupStore.Actions>()((set) => ({
  team: undefined,
  arriving: false,
  arrive: () => set({ arriving: true }),
  hold: (team) => set({ team }),
  release: () => set({ team: undefined }),
  reset: () => set({ team: undefined, arriving: false }),
}))

export namespace SetupStore {
  export interface State {
    /** The team made in the last step, while its token is on screen. */
    team: CreatedTeam | undefined
    /**
     * The account was just made on this page: the next steps are certain to follow, so the app
     * waits for the server's word instead of flashing its frame first.
     */
    arriving: boolean
  }
  export interface Actions {
    arrive: () => void
    hold: (team: CreatedTeam) => void
    release: () => void
    reset: () => void
  }
}
