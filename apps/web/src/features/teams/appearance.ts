import { TEAM_ICON_NAMES } from '@circi/core'
import { TEAM_COLORS, type TeamColor } from '@circi/ui'

export { TEAM_COLORS }
export type { TeamColor }

/** How many icons the picker draws at first, and each time "Show more icons" is pressed. */
export const ICON_PAGE = 60

export const isTeamColor = (value: string): value is TeamColor =>
  TEAM_COLORS.some((c) => c === value)

const ICON_SET: ReadonlySet<string> = new Set(TEAM_ICON_NAMES)

/** Whether `value` is a Lucide icon name (the only icons a team can store). */
export const isTeamIconName = (value: string | null): value is string =>
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
  if (words.length === 0) return [...TEAM_ICON_NAMES]
  const joined = words.join('-')
  const rank = (name: string) => (name === joined ? 0 : name.startsWith(words[0] ?? '') ? 1 : 2)
  return TEAM_ICON_NAMES.filter((name) => words.every((w) => name.includes(w))).toSorted(
    (a, b) => rank(a) - rank(b),
  )
}

/** What picking a colour or icon sends: only what changed. */
export function appearancePatch(
  current: { color: string; icon: string | null },
  next: { color: TeamColor; icon: string | null },
): { color?: TeamColor; icon?: string | null } {
  return {
    ...(next.color === current.color ? {} : { color: next.color }),
    ...(next.icon === current.icon ? {} : { icon: next.icon }),
  }
}
