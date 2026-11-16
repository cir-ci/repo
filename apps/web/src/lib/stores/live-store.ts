import { create } from 'zustand'

/**
 * Whether the live-update stream (`lib/live.ts`) is connected right now. Queries that used to poll
 * ask it how often to (`livePoll`): while the stream is up the server says what changed, and a
 * slow poll is only the safety net.
 */
export const useLiveStore = create<LiveStore.State & LiveStore.Actions>()((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
  reset: () => set({ connected: false }),
}))

export namespace LiveStore {
  export interface State {
    connected: boolean
  }
  export interface Actions {
    setConnected: (connected: boolean) => void
    reset: () => void
  }
}
