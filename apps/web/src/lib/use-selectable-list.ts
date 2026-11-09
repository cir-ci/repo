import { useAnnounce } from '@circi/ui'
import { useEffect } from 'react'

import { focusRow, leavesKeyToFocus, nextAfterRemoval } from './list-keys.ts'
import { useShortcutHandlers } from './shortcuts.ts'
import { useListStore } from './stores/list-store.ts'
import { useListNavigation, type NavGroup } from './use-list-navigation.ts'

/**
 * What a list screen (Reviews, Inbox, Triage, the builds list) shares: the selected row (the
 * store's cursor, else the first row), J / K that move it and the focus together, the preview
 * pane's flag, the Enter / Space shortcuts, and `settle` for an item that leaves the list. The
 * store is reset when the screen unmounts, so the next list starts clean.
 *
 * Space (`peek`) toggles the preview unless `peekable` is false; Enter (`open`) calls `onOpen`
 * with the selected row. Both leave the key to a focused control (`leavesKeyToFocus`).
 */
export function useSelectableList<T>({
  items,
  getId,
  groups,
  onSelect,
  onOpen,
  peekable = true,
}: useSelectableList.Options<T>): useSelectableList.Result<T> {
  const announce = useAnnounce()
  const selectedId = useListStore((s) => s.cursorId)
  const setSelectedId = useListStore((s) => s.setCursorId)
  const peek = useListStore((s) => s.peek)
  const togglePeek = useListStore((s) => s.togglePeek)
  useEffect(() => () => useListStore.getState().reset(), [])

  const selected = items.find((item) => getId(item) === selectedId) ?? items[0]
  const select = (item: T) => {
    setSelectedId(getId(item))
    onSelect?.(item)
  }

  const {
    ref: listElement,
    listRef,
    rowProps,
  } = useListNavigation({
    items,
    getId,
    selectedId: selected === undefined ? undefined : getId(selected),
    onSelect: select,
    ...(groups ? { groups } : {}),
  })

  /** Runs `act` for an item about to leave the list; once it is `done`, announces and selects the next. */
  const settle = (item: T, message: string, act: (done: () => void) => void) => {
    const next = nextAfterRemoval(items, getId, getId(item))
    act(() => {
      announce(message)
      setSelectedId(next)
      if (next) focusRow(listElement.current, next)
    })
  }

  useShortcutHandlers({
    ...(onOpen
      ? {
          open: (_action, event) => {
            if (leavesKeyToFocus(event) || !selected) return false
            onOpen(selected)
            return undefined
          },
        }
      : {}),
    ...(peekable
      ? {
          peek: (_action, event) => {
            if (leavesKeyToFocus(event) || !selected) return false
            togglePeek()
            return undefined
          },
        }
      : {}),
  })

  return {
    selected,
    selectedId: selected === undefined ? undefined : getId(selected),
    select,
    setSelectedId,
    peek,
    togglePeek,
    listElement,
    listRef,
    rowProps,
    settle,
  }
}

export namespace useSelectableList {
  export interface Options<T> {
    items: readonly T[]
    getId: (item: T) => string
    /** The items by group, when some can be collapsed (see `useListNavigation`). */
    groups?: readonly NavGroup<T>[] | undefined
    /** Called after J / K select an item. */
    onSelect?: (item: T) => void
    /** Enter on the selected row. */
    onOpen?: (item: T) => void
    /** Whether Space toggles the preview pane. Default true. */
    peekable?: boolean
  }
  export interface Result<T> {
    /** The cursor's item, else the first. */
    selected: T | undefined
    selectedId: string | undefined
    select: (item: T) => void
    setSelectedId: (id: string | undefined) => void
    peek: boolean
    togglePeek: () => void
    listElement: ReturnType<typeof useListNavigation>['ref']
    listRef: ReturnType<typeof useListNavigation>['listRef']
    rowProps: (id: string) => { 'data-row-id': string }
    /** See above: for an item that leaves the list. */
    settle: (item: T, message: string, act: (done: () => void) => void) => void
  }
}
