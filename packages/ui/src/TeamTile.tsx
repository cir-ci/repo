import BoringAvatar from 'boring-avatars'
import type { HTMLAttributes } from 'react'

import { teamPalette, useAvatarScheme } from './avatar-palettes.ts'
import { cx } from './cx.ts'
import { TEAM_ICONS, type TeamColor, type TeamIconName } from './team-icons.ts'

import styles from './TeamTile.module.css'

/** Icon size per tile size (12 / 14 / 16 / 24px). */
const ICON_SIZE = { 16: 12, 20: 14, 24: 16, 40: 24 } as const

/**
 * A team's identity mark: a rounded square holding a generated "marble" (`boring-avatars`) in
 * shades of the team's colour, with its Lucide icon on top in `tile-text` when it has one.
 * Identity, never state. Decorative (`aria-hidden`) when the team's name is written next to it;
 * with `labelled` it is an image named by the team.
 */
export function TeamTile({
  name,
  seed,
  color,
  icon,
  size = 16,
  labelled = false,
  className,
  ...rest
}: TeamTile.Props) {
  const { scheme, ref } = useAvatarScheme()
  const Glyph = icon ? TEAM_ICONS[icon] : undefined
  return (
    <span
      {...rest}
      ref={ref}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? name : undefined}
      aria-hidden={labelled ? undefined : true}
      data-size={size}
      data-color={color}
      className={cx(styles.root, className)}
    >
      <BoringAvatar
        variant="marble"
        name={seed ?? name}
        colors={teamPalette(color, scheme)}
        square
        size="100%"
        aria-hidden="true"
        role="presentation"
        data-avatar="marble"
        className={styles.marble}
      />
      {Glyph ? (
        <Glyph
          size={ICON_SIZE[size]}
          strokeWidth={1.75}
          aria-hidden="true"
          className={styles.icon}
        />
      ) : null}
    </span>
  )
}

export namespace TeamTile {
  export interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** The team's name: the accessible name when `labelled`, and the seed unless `seed` is given. */
    name: string
    /** What the marble is drawn from: the team's id (stable across renames). Defaults to `name`. */
    seed?: string
    color: TeamColor
    /** A Lucide icon name from `TEAM_ICON_NAMES`, drawn on top of the marble. */
    icon?: TeamIconName
    /** 16 in the sidebar, 20 in menus, 24 in the settings header, 40 on the team page. */
    size?: 16 | 20 | 24 | 40
    /** True when the name isn't next to the tile: it becomes an image named by `name`. */
    labelled?: boolean
  }
}
