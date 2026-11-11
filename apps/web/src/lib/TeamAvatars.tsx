import type { Team } from '@circi/api'
import { Avatar, Tooltip } from '@circi/ui'
import type { NavigateOptions } from '@tanstack/react-router'

import { useClientLink } from '#lib/use-client-link.ts'

import styles from './TeamAvatars.module.css'

/** How many avatars the stack draws before a "+N" chip stands for the rest. */
const LIMIT = 8

/**
 * Teams as a stack of small overlapping avatars. Each is a link to `link(team)` (client-side
 * navigation) with the team's name as its accessible name and tooltip (`note` adds to the
 * tooltip); past eight, a "+N" chip whose tooltip lists the rest.
 */
export function TeamAvatars<T extends TeamAvatars.Item>({
  teams,
  link,
  note,
  limit = LIMIT,
}: TeamAvatars.Props<T>) {
  const clientLink = useClientLink()
  const shown = teams.slice(0, limit)
  const rest = teams.slice(limit)
  return (
    <span className={styles.root}>
      {shown.map((team) => (
        <Tooltip key={team.slug} content={note ? `${team.name}: ${note(team)}` : team.name}>
          <a className={styles.item} aria-label={team.name} {...clientLink(link(team))}>
            <Avatar
              type="team"
              slug={team.slug}
              name={team.name}
              color={team.color}
              icon={team.icon}
              size={20}
            />
          </a>
        </Tooltip>
      ))}
      {rest.length > 0 ? (
        <Tooltip
          content={rest
            .map((team) => (note ? `${team.name}: ${note(team)}` : team.name))
            .join(', ')}
        >
          <span
            className={styles.more}
            tabIndex={0}
            aria-label={`${rest.length} more: ${rest.map((team) => team.name).join(', ')}`}
          >
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  )
}

export namespace TeamAvatars {
  export interface Item {
    slug: string
    name: string
    color: Team.Color
    icon: string | null
  }

  export interface Props<T extends Item = Item> {
    teams: readonly T[]
    /** Where a team's avatar goes. */
    link: (team: T) => NavigateOptions
    /** Extra words after the name in the tooltip ("web: off"). */
    note?: (team: T) => string
    /** Avatars drawn before the "+N" chip; 8 when left out. */
    limit?: number
  }
}
