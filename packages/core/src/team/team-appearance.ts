import { ValidationError } from '../errors.ts'

/**
 * How a team looks in the sidebar and lists: a tile colour and an optional icon. The icon list
 * is mirrored by `@circi/ui` (which draws them); `apps/web/test` checks the two stay equal.
 */

/** The tile palette: `--circi-team-<colour>` in the theme. */
export const TEAM_COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const
export type TeamColor = (typeof TEAM_COLORS)[number]

/** Lucide icon names a team may pick; a team with none shows its first letter. */
export const TEAM_ICON_NAMES = [
  'layout-grid',
  'book-open',
  'globe',
  'shopping-cart',
  'smartphone',
  'palette',
  'code',
  'box',
  'rocket',
  'layers',
  'compass',
  'flask-conical',
  'gauge',
  'monitor',
  'file-text',
  'chart-column',
  'credit-card',
  'users',
  'mail',
  'map',
  'camera',
  'puzzle',
  'zap',
  'shield',
  'store',
  'car',
  'heart',
  'leaf',
  'cloud',
  'terminal',
  'component',
] as const
export type TeamIconName = (typeof TEAM_ICON_NAMES)[number]

export function isTeamColor(value: unknown): value is TeamColor {
  return TEAM_COLORS.some((c) => c === value)
}

export function isTeamIcon(value: unknown): value is TeamIconName {
  return TEAM_ICON_NAMES.some((i) => i === value)
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
