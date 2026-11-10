import { Avatar } from '@circi/ui'

import { useSidebarModel } from '#features/sidebar/api.ts'

/**
 * The team's mark (colour and icon as the sidebar shows it), looked up by slug from the
 * workspace's sidebar model; a team the model doesn't list yet gets the default slate mark.
 */
export function useTeamMark(workspace: string) {
  const { data } = useSidebarModel(workspace)
  return (slug: string, name: string, size: Avatar.TeamProps['size'] = 16) => {
    const team = data?.teams.find((t) => t.slug === slug)
    return (
      <Avatar
        type="team"
        aria-hidden
        slug={slug}
        name={name}
        color={team?.color ?? 'slate'}
        icon={team?.icon ?? null}
        size={size}
      />
    )
  }
}
