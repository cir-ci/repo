import { ValidationError } from '../errors.ts'
import { LUCIDE_ICON_NAMES } from './lucide-icon-names.ts'

/**
 * How a team looks in the sidebar and lists: a tile colour and an optional icon. `@circi/ui` draws
 * the icons from lucide-react itself; `apps/web/test` checks its names equal the list here.
 */

/** The tile palette: `--circi-team-<colour>` in the theme. */
export const TEAM_COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const
export type TeamColor = (typeof TEAM_COLORS)[number]

/**
 * Lucide icon names a team may pick: every icon of the installed lucide-react (generated, see
 * `lucide-icon-names.ts`). A team with none shows only its marble.
 */
export const TEAM_ICON_NAMES = LUCIDE_ICON_NAMES
export type TeamIconName = string

const ICON_SET: ReadonlySet<string> = new Set(LUCIDE_ICON_NAMES)

export function isTeamColor(value: unknown): value is TeamColor {
  return TEAM_COLORS.some((c) => c === value)
}

export function isTeamIcon(value: unknown): value is TeamIconName {
  return typeof value === 'string' && ICON_SET.has(value)
}

/** Throws a `ValidationError` unless `value` is a palette colour. */
export function assertTeamColor(value: unknown): asserts value is TeamColor {
  if (!isTeamColor(value)) {
    throw new ValidationError(`Colour must be one of: ${TEAM_COLORS.join(', ')}`)
  }
}

/** Throws a `ValidationError` unless `value` is an allowed icon name. */
export function assertTeamIcon(value: unknown): asserts value is TeamIconName {
  if (!isTeamIcon(value)) throw new ValidationError(`Unknown icon "${String(value)}"`)
}

/**
 * The colour a new team gets: a stable hash of its name (FNV-1a, case and edge spaces
 * ignored), so the same name always lands on the same colour and names spread over all six.
 */
export function teamColorFor(name: string): TeamColor {
  let hash = 0x811c9dc5
  for (const ch of name.trim().toLowerCase()) {
    hash ^= ch.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return TEAM_COLORS[hash % TEAM_COLORS.length] ?? 'slate'
}
