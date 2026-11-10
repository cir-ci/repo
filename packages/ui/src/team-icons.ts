import { iconNames } from 'lucide-react/dynamic.mjs'

/**
 * Every Lucide icon a team may pick for its tile (a team stores one of these names, or none).
 * `@circi/core` keeps a generated copy that the server validates against
 * (`pnpm icons:generate`); `apps/web/test` checks the two are equal.
 */
export const TEAM_ICON_NAMES: readonly string[] = iconNames

/** The team tile palette: `--circi-team-<colour>`. */
export const TEAM_COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const

export type TeamColor = (typeof TEAM_COLORS)[number]
