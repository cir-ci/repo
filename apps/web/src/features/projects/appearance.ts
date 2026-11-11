import { PROJECT_ICON_NAMES } from '@circi/core'
import { PROJECT_COLORS, type ProjectColor } from '@circi/ui'

export { PROJECT_COLORS }
export type { ProjectColor }

/** How many icons each page of the picker's infinite query holds. */
export const ICON_PAGE = 60

/** One row of the icon grid: a 28 px cell and the 4 px gap under it. */
export const ICON_ROW_HEIGHT = 32

/** A cell's width plus the gap after it (`.cell` in IconPicker.module.css). */
const ICON_STRIDE = 40

/** How many icon cells fit across a grid `width` pixels wide (at least one). */
export function iconColumns(width: number): number {
  // The box's 4 px padding on each side, and no gap after the last cell.
  return Math.max(1, Math.floor((width - 8 + 4) / ICON_STRIDE))
}

export const isProjectColor = (value: string): value is ProjectColor =>
  PROJECT_COLORS.some((c) => c === value)

const ICON_SET: ReadonlySet<string> = new Set(PROJECT_ICON_NAMES)

/** Whether `value` is a Lucide icon name (the only icons a project can store). */
export const isProjectIconName = (value: string | null): value is string =>
  value !== null && ICON_SET.has(value)

/** "shopping-cart" as people say it: "Shopping cart". */
export function iconLabel(name: string): string {
  const words = name.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const colourLabel = (color: string) => color.charAt(0).toUpperCase() + color.slice(1)

/**
 * The icons whose name contains every word typed (the search box above the grid), best first:
 * the exact name, then names that start with the first word, then the rest in Lucide's order.
 * Names only: the installed Lucide package carries no tags.
 */
export function filterIcons(query: string): string[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
  if (words.length === 0) return [...PROJECT_ICON_NAMES]
  const joined = words.join('-')
  const rank = (name: string) => (name === joined ? 0 : name.startsWith(words[0] ?? '') ? 1 : 2)
  return PROJECT_ICON_NAMES.filter((name) => words.every((w) => name.includes(w))).toSorted(
    (a, b) => rank(a) - rank(b),
  )
}

/** What picking a colour or icon sends: only what changed. */
export function appearancePatch(
  current: { color: string; icon: string | null },
  next: { color: ProjectColor; icon: string | null },
): { color?: ProjectColor; icon?: string | null } {
  return {
    ...(next.color === current.color ? {} : { color: next.color }),
    ...(next.icon === current.icon ? {} : { icon: next.icon }),
  }
}
