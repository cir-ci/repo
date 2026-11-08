import { TEAM_COLORS, TEAM_ICON_NAMES, type TeamColor, type TeamIconName } from '@circi/ui'

export { TEAM_COLORS, TEAM_ICON_NAMES }
export type { TeamColor, TeamIconName }

export const isTeamColor = (value: string): value is TeamColor =>
  TEAM_COLORS.some((c) => c === value)

export const isTeamIconName = (value: string | null): value is TeamIconName =>
  TEAM_ICON_NAMES.some((i) => i === value)

/** "layout-grid" as people say it. */
export const iconLabel = (name: TeamIconName) => name.replaceAll('-', ' ')

export const colourLabel = (color: string) => color.charAt(0).toUpperCase() + color.slice(1)

/** The icons whose name contains every word typed (the search box above the grid). */
export function filterIcons(query: string): TeamIconName[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return TEAM_ICON_NAMES.filter((name) => {
    const label = iconLabel(name)
    return words.every((w) => label.includes(w))
  })
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
