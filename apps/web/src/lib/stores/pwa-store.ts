import { create } from 'zustand'

import {
  EMPTY_PROMPTS,
  parseStoredPrompts,
  type PushPermission,
  putOff,
  type StoredPrompts,
} from '#lib/prompt-rules.ts'

export const PWA_KEY = 'circi-pwa-prompts'

function read(): StoredPrompts {
  try {
    return parseStoredPrompts(localStorage.getItem(PWA_KEY))
  } catch {
    return EMPTY_PROMPTS
  }
}

function write(state: StoredPrompts): void {
  try {
    localStorage.setItem(PWA_KEY, JSON.stringify(state))
  } catch {
    // Storage blocked or full (a private window): the answers last until the page reloads.
  }
}

const stored = (s: PwaStore.State): StoredPrompts => ({
  visits: s.visits,
  approved: s.approved,
  install: s.install,
  push: s.push,
})

/**
 * What the app has learnt about this device for the install and notification offers: how often
 * it was opened, whether the person approved something, and how often each offer was put off
 * ("Not now"). Kept in this browser only (localStorage, guarded: it can be missing). The rest
 * (the browser's install prompt, the notification permission) is read from the browser at start.
 */
export const usePwaStore = create<PwaStore.State & PwaStore.Actions>()((set, get) => ({
  ...read(),
  ...runtime(),
  recordVisit: () => {
    set((s) => ({ visits: s.visits + 1 }))
    write(stored(get()))
  },
  recordApproval: () => {
    if (get().approved) return
    set({ approved: true })
    write(stored(get()))
  },
  putOffInstall: (now) => {
    set((s) => ({ install: putOff(s.install, now) }))
    write(stored(get()))
  },
  putOffPush: (now) => {
    set((s) => ({ push: putOff(s.push, now) }))
    write(stored(get()))
  },
  setInstallEvent: (installEvent) => set({ installEvent }),
  setInstalled: (installed) => set({ installed }),
  setPush: (push) => set({ pushPermission: push.permission, pushEndpoint: push.endpoint }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  reset: () => set({ ...read(), ...runtime() }),
}))

function runtime(): PwaStore.Runtime {
  return {
    installEvent: null,
    installed: false,
    pushPermission: 'unsupported',
    pushEndpoint: null,
    sheetOpen: false,
  }
}

/** The browser's "install this app" prompt, held until the person asks for it. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export namespace PwaStore {
  export interface Runtime {
    /** The browser offered to install; null before it does, or where it never does (Safari, Firefox). */
    installEvent: InstallPromptEvent | null
    /** Running as the installed app (standalone window), or just installed. */
    installed: boolean
    pushPermission: PushPermission
    /** This browser's push endpoint when it is subscribed. */
    pushEndpoint: string | null
    /** The Add to Home Screen steps (iPhone has no install prompt). */
    sheetOpen: boolean
  }
  export interface State extends StoredPrompts, Runtime {}
  export interface Actions {
    recordVisit: () => void
    recordApproval: () => void
    putOffInstall: (now: number) => void
    putOffPush: (now: number) => void
    setInstallEvent: (event: InstallPromptEvent | null) => void
    setInstalled: (installed: boolean) => void
    setPush: (push: { permission: PushPermission; endpoint: string | null }) => void
    setSheetOpen: (open: boolean) => void
    /** Reads what the browser holds again (tests clear the storage first). */
    reset: () => void
  }
}
