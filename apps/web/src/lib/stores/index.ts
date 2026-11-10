import { DISPLAY_KEY } from '#features/builds/list/display-options.ts'

import { useDisplayStore } from './display-store.ts'
import { useListStore } from './list-store.ts'
import { useOverlayStore } from './overlay-store.ts'
import { RECENT_KEY, useRecentStore } from './recent-store.ts'
import { useShortcutStore } from './shortcut-store.ts'
import { useUndoStore } from './undo-store.ts'
import { useWorkspaceStore } from './workspace-store.ts'

/** Puts every store back to its initial state; tests call it so state never leaks between them. */
export function resetStores(): void {
  useShortcutStore.getState().reset()
  useOverlayStore.getState().reset()
  useListStore.getState().reset()
  useWorkspaceStore.getState().reset()
  useUndoStore.getState().reset()
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {
    // No storage to clear.
  }
  useRecentStore.getState().reset()
  try {
    localStorage.removeItem(DISPLAY_KEY)
  } catch {
    // No storage to clear.
  }
  useDisplayStore.getState().reset()
}
