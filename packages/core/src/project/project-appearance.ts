import { ValidationError } from '../errors.ts'
import { LUCIDE_ICON_NAMES } from './lucide-icon-names.ts'

/**
 * How a project looks in the sidebar and lists: a tile colour and an optional icon. `@circi/ui` draws
 * the icons from lucide-react itself; `apps/web/test` checks its names equal the list here.
 */

/** The tile palette: `--circi-project-<colour>` in the theme. */
export const PROJECT_COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const
export type ProjectColor = (typeof PROJECT_COLORS)[number]

/**
 * Lucide icon names a project may pick: every icon of the installed lucide-react (generated, see
 * `lucide-icon-names.ts`). A project with none shows only its marble.
 */
export const PROJECT_ICON_NAMES = LUCIDE_ICON_NAMES
export type ProjectIconName = string

const ICON_SET: ReadonlySet<string> = new Set(LUCIDE_ICON_NAMES)

export function isProjectColor(value: unknown): value is ProjectColor {
  return PROJECT_COLORS.some((c) => c === value)
}

export function isProjectIcon(value: unknown): value is ProjectIconName {
  return typeof value === 'string' && ICON_SET.has(value)
}

/** Throws a `ValidationError` unless `value` is a palette colour. */
export function assertProjectColor(value: unknown): asserts value is ProjectColor {
  if (!isProjectColor(value)) {
    throw new ValidationError(`Colour must be one of: ${PROJECT_COLORS.join(', ')}`)
  }
}

/** Throws a `ValidationError` unless `value` is an allowed icon name. */
export function assertProjectIcon(value: unknown): asserts value is ProjectIconName {
  if (!isProjectIcon(value)) throw new ValidationError(`Unknown icon "${String(value)}"`)
}

/**
 * The colour a new project gets: a stable hash of its name (FNV-1a, case and edge spaces
 * ignored), so the same name always lands on the same colour and names spread over all six.
 */
export function projectColorFor(name: string): ProjectColor {
  let hash = 0x811c9dc5
  for (const ch of name.trim().toLowerCase()) {
    hash ^= ch.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length] ?? 'slate'
}
