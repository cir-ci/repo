import { DISPLAY_KEY } from '#features/builds/list/display-options.ts'

import { useDisplayStore } from './display-store.ts'
import { useListStore } from './list-store.ts'
import { useOverlayStore } from './overlay-store.ts'
import { PANES_KEY, usePaneStore } from './pane-store.ts'
import { RECENT_SEARCHES_KEY, useRecentSearchesStore } from './recent-searches-store.ts'
import { RECENT_KEY, useRecentStore } from './recent-store.ts'
import { SETTINGS_RETURN_KEY, useSettingsReturnStore } from './settings-return-store.ts'
import { useShortcutStore } from './shortcut-store.ts'
import { useToastStore } from './toast-store.ts'
import { useWorkspaceStore } from './workspace-store.ts'

/** Puts every store back to its initial state; tests call it so state never leaks between them. */
export function resetStores(): void {
  useShortcutStore.getState().reset()
  useOverlayStore.getState().reset()
  useListStore.getState().reset()
  useWorkspaceStore.getState().reset()
  useToastStore.getState().reset()
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {
    // No storage to clear.
  }
  useRecentStore.getState().reset()
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY)
  } catch {
    // No storage to clear.
  }
  useRecentSearchesStore.getState().reset()
  try {
    sessionStorage.removeItem(SETTINGS_RETURN_KEY)
  } catch {
    // No storage to clear.
  }
  useSettingsReturnStore.getState().reset()
  try {
    localStorage.removeItem(DISPLAY_KEY)
  } catch {
    // No storage to clear.
  }
  useDisplayStore.getState().reset()
  try {
    localStorage.removeItem(PANES_KEY)
  } catch {
    // No storage to clear.
  }
  usePaneStore.getState().reset()
}
