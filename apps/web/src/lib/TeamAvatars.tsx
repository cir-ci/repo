import type { Team } from '@circi/api'
import { Avatar, AvatarStack, Tooltip } from '@circi/ui'
import type { NavigateOptions } from '@tanstack/react-router'
import { Fragment } from 'react'

import { useClientLink } from '#lib/use-client-link.ts'

/** How many avatars the stack draws before a "+N" chip stands for the rest. */
const LIMIT = 8

/**
 * Teams as a stack of small overlapping avatars (`AvatarStack`): the one team stack of the
 * dashboard. With `link`, each is a link to `link(team)` (client-side navigation) named by the
 * team; with a `note`, or by default for links, the team's name (plus the note) is its tooltip.
 * Without `link` the avatars are plain. Past `limit`, a "+N" chip whose tooltip lists the rest
 * (`overflow={false}`: no chip, for a stack followed by its own count). Other props go to the
 * stack: `aria-hidden` makes it decoration.
 */
export function TeamAvatars<T extends TeamAvatars.Item>({
  teams,
  link,
  note,
  tooltips = link !== undefined,
  overflow = true,
  limit = LIMIT,
  ...rest
}: TeamAvatars.Props<T>) {
  const clientLink = useClientLink()
  const shown = teams.slice(0, limit)
  const hidden = overflow ? teams.slice(limit) : []
  const text = (team: T) => (note ? `${team.name}: ${note(team)}` : team.name)
  return (
    <AvatarStack
      shape="rounded"
      {...rest}
      more={{
        count: hidden.length,
        ...(link === undefined
          ? {}
          : { label: `${hidden.length} more: ${hidden.map((team) => team.name).join(', ')}` }),
        ...(tooltips ? { tooltip: hidden.map(text).join(', ') } : {}),
      }}
    >
      {shown.map((team) => {
        const avatar = (
          <Avatar
            type="team"
            slug={team.slug}
            name={team.name}
            color={team.color}
            icon={team.icon}
            size={20}
          />
        )
        const item =
          link === undefined ? (
            <span>{avatar}</span>
          ) : (
            <a aria-label={team.name} {...clientLink(link(team))}>
              {avatar}
            </a>
          )
        return tooltips ? (
          <Tooltip key={team.id ?? team.slug} content={text(team)}>
            {item}
          </Tooltip>
        ) : (
          <Fragment key={team.id ?? team.slug}>{item}</Fragment>
        )
      })}
    </AvatarStack>
  )
}

export namespace TeamAvatars {
  export interface Item {
    slug: string
    name: string
    color: Team.Color
    icon: string | null
    /** What tells teams apart when slugs repeat (several workspaces); the slug when left out. */
    id?: string
  }

  export interface Props<T extends Item = Item> extends Omit<
    AvatarStack.Props,
    'children' | 'more' | 'shape'
  > {
    teams: readonly T[]
    /** Where a team's avatar goes; without it the avatars are not links. */
    link?: (team: T) => NavigateOptions
    /** Extra words after the name in the tooltip ("web: off"). */
    note?: (team: T) => string
    /** A tooltip with each team's name; on when `link` is given. */
    tooltips?: boolean
    /** The "+N" chip for the teams past `limit`; true. */
    overflow?: boolean
    /** Avatars drawn before the "+N" chip; 8 when left out. */
    limit?: number
  }
}
