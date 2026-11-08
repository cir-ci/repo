import type { Build } from '@circi/api'

import { buildState } from '#features/builds/build-state.ts'

export const GROUPS = ['none', 'status', 'branch', 'author', 'day'] as const
export type GroupBy = (typeof GROUPS)[number]
export const GROUP_LABEL: Record<GroupBy, string> = {
  none: 'No grouping',
  status: 'Status',
  branch: 'Branch',
  author: 'Author',
  day: 'Day',
}

export const ORDERS = ['newest', 'oldest'] as const
export type Order = (typeof ORDERS)[number]
export const ORDER_LABEL: Record<Order, string> = { newest: 'Newest first', oldest: 'Oldest first' }

export const PROPERTIES = ['branch', 'author', 'date', 'counts'] as const
export type Property = (typeof PROPERTIES)[number]
export const PROPERTY_LABEL: Record<Property, string> = {
  branch: 'Branch and commit',
  author: 'Author',
  date: 'Time',
  counts: 'Change counts',
}

export interface DisplayOptions {
  groupBy: GroupBy
  order: Order
  show: Record<Property, boolean>
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  groupBy: 'none',
  order: 'newest',
  show: { branch: true, author: true, date: true, counts: true },
}

export const DISPLAY_KEY = 'circi.builds.display'

/** Options from untrusted text (what localStorage holds): anything wrong falls back to the default. */
export function parseDisplay(text: string | null | undefined): DisplayOptions {
  let raw: unknown
  try {
    raw = text ? JSON.parse(text) : undefined
  } catch {
    raw = undefined
  }
  const obj = typeof raw === 'object' && raw !== null ? raw : {}
  const get = (key: string): unknown => (key in obj ? Reflect.get(obj, key) : undefined)
  const shown = get('show')
  const show = { ...DEFAULT_DISPLAY.show }
  if (typeof shown === 'object' && shown !== null) {
    for (const p of PROPERTIES) {
      const value = Reflect.get(shown, p)
      if (typeof value === 'boolean') show[p] = value
    }
  }
  return {
    groupBy: GROUPS.find((g) => g === get('groupBy')) ?? DEFAULT_DISPLAY.groupBy,
    order: ORDERS.find((o) => o === get('order')) ?? DEFAULT_DISPLAY.order,
    show,
  }
}

/** Reads the person's options; storage may be missing or blocked, then the defaults apply. */
export function loadDisplay(storage?: Pick<Storage, 'getItem'>): DisplayOptions {
  try {
    return parseDisplay((storage ?? localStorage).getItem(DISPLAY_KEY))
  } catch {
    return DEFAULT_DISPLAY
  }
}

export function saveDisplay(options: DisplayOptions, storage?: Pick<Storage, 'setItem'>): void {
  try {
    ;(storage ?? localStorage).setItem(DISPLAY_KEY, JSON.stringify(options))
  } catch {
    // Not persisted (private window, blocked storage): the options still apply for this visit.
  }
}

/** The page's builds, newest first by number as the server returns them, or reversed. */
export function orderBuilds<T extends Pick<Build.ListItem, 'number'>>(
  builds: readonly T[],
  order: Order,
): T[] {
  return builds.toSorted((a, b) => (order === 'newest' ? b.number - a.number : a.number - b.number))
}

export interface BuildGroup<T> {
  key: string
  label: string
  builds: T[]
}

function groupOf(b: Build.ListItem, by: Exclude<GroupBy, 'none'>): string {
  if (by === 'status') return buildState(b).label
  if (by === 'branch') return b.branch ?? 'No branch'
  if (by === 'author') return b.author?.name ?? b.author?.login ?? 'Unknown author'
  return b.createdAt.slice(0, 10)
}

/** The builds under their group headings, in the order the groups first appear. */
export function groupBuilds(
  builds: readonly Build.ListItem[],
  by: GroupBy,
): BuildGroup<Build.ListItem>[] {
  if (by === 'none') return [{ key: '', label: '', builds: [...builds] }]
  const groups: BuildGroup<Build.ListItem>[] = []
  for (const b of builds) {
    const label = groupOf(b, by)
    const found = groups.find((g) => g.key === label)
    if (found) found.builds.push(b)
    else groups.push({ key: label, label, builds: [b] })
  }
  return groups
}
