import { TEAM_ICON_NAMES, TeamTile, type TeamIconName } from '@circi/ui'

import { useSidebarModel } from '#features/sidebar/api.ts'

/**
 * The team's tile (colour and icon as the sidebar shows it), looked up by slug from the
 * workspace's sidebar model; a team the model doesn't list yet gets the default slate tile.
 */
export function useTeamMark(workspace: string) {
  const { data } = useSidebarModel(workspace)
  return (slug: string, name: string, size: TeamTile.Props['size'] = 16) => {
    const team = data?.teams.find((t) => t.slug === slug)
    const icon = TEAM_ICON_NAMES.find((n): n is TeamIconName => n === team?.icon)
    return (
      <TeamTile
        name={name}
        color={team?.color ?? 'slate'}
        size={size}
        {...(icon ? { icon } : {})}
      />
    )
  }
}
