import { Avatar } from '@circi/ui'

import { useSidebarModel } from '#features/sidebar/api.ts'

/**
 * The project's mark (colour and icon as the sidebar shows it), looked up by slug from the
 * workspace's sidebar model; a project the model doesn't list yet gets the default slate mark.
 */
export function useProjectMark(workspace: string) {
  const { data } = useSidebarModel(workspace)
  return (slug: string, name: string, size: Avatar.ProjectProps['size'] = 16) => {
    const project = data?.projects.find((t) => t.slug === slug)
    return (
      <Avatar
        type="project"
        aria-hidden
        slug={slug}
        name={name}
        color={project?.color ?? 'slate'}
        icon={project?.icon ?? null}
        size={size}
      />
    )
  }
}
