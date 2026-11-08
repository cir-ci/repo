import type { HTMLAttributes } from 'react'

import { cx } from './cx.ts'
import { TEAM_ICONS, type TeamColor, type TeamIconName } from './team-icons.ts'

import styles from './TeamTile.module.css'

/** Icon size per tile size (12 / 14 / 16 / 24px). */
const ICON_SIZE = { 16: 12, 20: 14, 24: 16, 40: 24 } as const

/**
 * A team's identity mark: a rounded square in the team's colour holding its first letter, or a
 * Lucide icon, in `tile-text`. Identity, never state. Decorative (`aria-hidden`) when the team's
 * name is written next to it; with `labelled` it is an image named by the team.
 */
export function TeamTile({
  name,
  color,
  icon,
  size = 16,
  labelled = false,
  className,
  ...rest
}: TeamTile.Props) {
  const Glyph = icon ? TEAM_ICONS[icon] : undefined
  return (
    <span
      {...rest}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? name : undefined}
      aria-hidden={labelled ? undefined : true}
      data-size={size}
      data-color={color}
      className={cx(styles.root, className)}
    >
      {Glyph ? (
        <Glyph size={ICON_SIZE[size]} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        (name.trim()[0]?.toUpperCase() ?? '?')
      )}
    </span>
  )
}

export namespace TeamTile {
  export interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** The team's name: its first letter is the tile's content, and the accessible name when `labelled`. */
    name: string
    color: TeamColor
    /** A Lucide icon name from `TEAM_ICON_NAMES`, shown instead of the letter. */
    icon?: TeamIconName
    /** 16 in the sidebar, 20 in menus, 24 in the settings header, 40 on the team page. */
    size?: 16 | 20 | 24 | 40
    /** True when the name isn't next to the tile: it becomes an image named by `name`. */
    labelled?: boolean
  }
}
