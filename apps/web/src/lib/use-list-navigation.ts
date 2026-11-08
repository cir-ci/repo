import { useCallback, useRef } from 'react'

import { useShortcutHandlers } from './shortcuts.ts'

/** The index `delta` steps from `current` in a list of `length`, stopping at the ends; none when empty. */
export function stepIndex(length: number, current: number, delta: 1 | -1): number | undefined {
  if (length === 0) return undefined
  if (current < 0) return delta > 0 ? 0 : length - 1
  return Math.min(length - 1, Math.max(0, current + delta))
}

const FOCUSABLE = 'a[href], button, input, [tabindex]'

/** Items in a group; a collapsed group shows only its header, which J / K stop on instead of its items. */
export interface NavGroup<T> {
  id: string
  items: readonly T[]
  collapsed: boolean
}

/** Where J / K can land: an item's row, or a collapsed group's header. */
export type Stop<T> = { type: 'item'; id: string; item: T } | { type: 'group'; id: string }

/**
 * The places J / K visit in order: every item of an open group, and the header alone for a
 * collapsed group (its items are not on screen), so the walk enters a collapsed group instead of
 * skipping over it.
 */
export function navigationStops<T>(
  groups: readonly NavGroup<T>[],
  getId: (item: T) => string,
): Stop<T>[] {
  return groups.flatMap((g): Stop<T>[] =>
    g.collapsed
      ? [{ type: 'group', id: g.id }]
      : g.items.map((item) => ({ type: 'item', id: getId(item), item })),
  )
}

/**
 * Where the walk is now, as a position in `stops`: the focused collapsed group's header, just
 * before the first item of a focused open group's header (a half step), else the selected item
 * (-1 when there is none). `focusedGroup` is the group whose header holds focus, if any.
 */
export function walkPosition<T>(
  stops: readonly Stop<T>[],
  groups: readonly NavGroup<T>[],
  focusedGroup: string | undefined,
  selectedId: string | undefined,
  getId: (item: T) => string,
): number {
  if (focusedGroup !== undefined) {
    const header = stops.findIndex((s) => s.type === 'group' && s.id === focusedGroup)
    if (header >= 0) return header
    const first = groups.find((g) => g.id === focusedGroup)?.items[0]
    const at =
      first === undefined ? -1 : stops.findIndex((s) => s.type === 'item' && s.id === getId(first))
    if (at >= 0) return at - 0.5
  }
  return stops.findIndex((s) => s.type === 'item' && s.id === selectedId)
}

/** The stop one step from a (possibly half-step) position, stopping at the ends. */
export function stepStop(length: number, position: number, delta: 1 | -1): number | undefined {
  if (length === 0) return undefined
  if (position < 0) return delta > 0 ? 0 : length - 1
  const to = delta > 0 ? Math.floor(position) + 1 : Math.ceil(position) - 1
  return Math.min(length - 1, Math.max(0, to))
}

/**
 * J / K for a list of rows: selects the next or previous item AND moves DOM focus to its row, so
 * the selection and the focus ring never part. Put `ref` on the list and spread `rowProps(id)` on
 * each row's wrapper (the first focusable thing inside it, a `ListRow`, takes the focus).
 */
export function useListNavigation<T>({ items, getId, selectedId, onSelect, groups }: Options<T>) {
  const ref = useRef<HTMLElement | null>(null)

  const moveToGroup = (id: string) => {
    const header = [...(ref.current?.querySelectorAll('[data-group-id]') ?? [])].find(
      (el) => el.getAttribute('data-group-id') === id,
    )
    const trigger = header?.querySelector('button')
    if (trigger instanceof HTMLElement) {
      trigger.focus()
      trigger.scrollIntoView({ block: 'nearest' })
    }
  }

  const move = (delta: 1 | -1) => {
    if (groups) {
      const stops = navigationStops(groups, getId)
      const active = document.activeElement
      const inRow = active instanceof Element && active.closest('[data-row-id]') !== null
      const focusedGroup =
        active instanceof Element && !inRow && ref.current?.contains(active)
          ? (active.closest('[data-group-id]')?.getAttribute('data-group-id') ?? undefined)
          : undefined
      const to = stepStop(
        stops.length,
        walkPosition(stops, groups, focusedGroup, selectedId, getId),
        delta,
      )
      const stop = to === undefined ? undefined : stops[to]
      if (stop?.type === 'group') {
        moveToGroup(stop.id)
        return
      }
      if (stop?.type === 'item') focusItem(stop.item)
      return
    }
    const index = stepIndex(
      items.length,
      items.findIndex((item) => getId(item) === selectedId),
      delta,
    )
    const item = index === undefined ? undefined : items[index]
    if (item === undefined) return
    focusItem(item)
  }

  function focusItem(item: T) {
    onSelect(item)
    const row = [...(ref.current?.querySelectorAll('[data-row-id]') ?? [])].find(
      (el) => el.getAttribute('data-row-id') === getId(item),
    )
    const target = row?.matches(FOCUSABLE) ? row : row?.querySelector(FOCUSABLE)
    if (target instanceof HTMLElement) {
      target.focus()
      target.scrollIntoView({ block: 'nearest' })
    }
  }

  useShortcutHandlers({ next: () => move(1), previous: () => move(-1) })

  /** Put this on the list element (`ref={list.listRef}`). */
  const listRef = useCallback((el: HTMLElement | null) => {
    ref.current = el
  }, [])

  return { ref, listRef, rowProps: (id: string) => ({ 'data-row-id': id }) }
}

interface Options<T> {
  items: readonly T[]
  getId: (item: T) => string
  /**
   * The items by group, when some groups can be collapsed (put `data-group-id` on each group's
   * root, with its header button inside). J / K then stop on a collapsed group's header: Enter or
   * Right opens it, and the next J enters it.
   */
  groups?: readonly NavGroup<T>[] | undefined
  selectedId: string | undefined
  /** Called with the item J / K reached; the caller owns what "selected" means (a URL, state). */
  onSelect: (item: T) => void
}
