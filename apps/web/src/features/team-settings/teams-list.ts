import type { Team } from '@circi/api'

/** The teams whose name or repository address ("acme/web-app") contains what was typed, case aside. */
export function findTeams(teams: ReadonlyArray<Team.Overview>, query: string): Team.Overview[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...teams]
  return teams.filter(
    (o) =>
      o.team.name.toLowerCase().includes(needle) ||
      `${o.workspace.slug}/${o.team.slug}`.toLowerCase().includes(needle),
  )
}
