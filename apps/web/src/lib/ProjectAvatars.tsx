import type { Project } from '@circi/api'
import { Avatar, AvatarStack, Tooltip } from '@circi/ui'
import type { NavigateOptions } from '@tanstack/react-router'
import { Fragment } from 'react'

import { useClientLink } from '#lib/use-client-link.ts'

/** How many avatars the stack draws before a "+N" chip stands for the rest. */
const LIMIT = 8

/**
 * Projects as a stack of small overlapping avatars (`AvatarStack`): the one project stack of the
 * dashboard. With `link`, each is a link to `link(project)` (client-side navigation) named by the
 * project; with a `note`, or by default for links, the project's name (plus the note) is its tooltip.
 * Without `link` the avatars are plain. Past `limit`, a "+N" chip whose tooltip lists the rest
 * (`overflow={false}`: no chip, for a stack followed by its own count). Other props go to the
 * stack: `aria-hidden` makes it decoration.
 */
export function ProjectAvatars<T extends ProjectAvatars.Item>({
  projects,
  link,
  note,
  tooltips = link !== undefined,
  overflow = true,
  limit = LIMIT,
  ...rest
}: ProjectAvatars.Props<T>) {
  const clientLink = useClientLink()
  const shown = projects.slice(0, limit)
  const hidden = overflow ? projects.slice(limit) : []
  const text = (project: T) => (note ? `${project.name}: ${note(project)}` : project.name)
  return (
    <AvatarStack
      shape="rounded"
      {...rest}
      more={{
        count: hidden.length,
        ...(link === undefined
          ? {}
          : {
              label: `${hidden.length} more: ${hidden.map((project) => project.name).join(', ')}`,
            }),
        ...(tooltips ? { tooltip: hidden.map(text).join(', ') } : {}),
      }}
    >
      {shown.map((project) => {
        const avatar = (
          <Avatar
            type="project"
            slug={project.slug}
            name={project.name}
            color={project.color}
            icon={project.icon}
            size={20}
          />
        )
        const item =
          link === undefined ? (
            <span>{avatar}</span>
          ) : (
            <a aria-label={project.name} {...clientLink(link(project))}>
              {avatar}
            </a>
          )
        return tooltips ? (
          <Tooltip key={project.id ?? project.slug} content={text(project)}>
            {item}
          </Tooltip>
        ) : (
          <Fragment key={project.id ?? project.slug}>{item}</Fragment>
        )
      })}
    </AvatarStack>
  )
}

export namespace ProjectAvatars {
  export interface Item {
    slug: string
    name: string
    color: Project.Color
    icon: string | null
    /** What tells projects apart when slugs repeat (several workspaces); the slug when left out. */
    id?: string
  }

  export interface Props<T extends Item = Item> extends Omit<
    AvatarStack.Props,
    'children' | 'more' | 'shape'
  > {
    projects: readonly T[]
    /** Where a project's avatar goes; without it the avatars are not links. */
    link?: (project: T) => NavigateOptions
    /** Extra words after the name in the tooltip ("web: off"). */
    note?: (project: T) => string
    /** A tooltip with each project's name; on when `link` is given. */
    tooltips?: boolean
    /** The "+N" chip for the projects past `limit`; true. */
    overflow?: boolean
    /** Avatars drawn before the "+N" chip; 8 when left out. */
    limit?: number
  }
}
