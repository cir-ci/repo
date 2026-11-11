import type { Search } from '@circi/api'

import type { Chip, ChipKind } from './entry.ts'

/**
 * How the text in the field is read: a prefix typed first (`#`, `/`, `>`, `@`) becomes a kind chip,
 * `in:web` or `project:web` followed by a space (or Tab) becomes a project chip, and the rest is what
 * is searched. A chip is removed with Backspace in the empty field, or its own button.
 */

export const KIND_CHIPS: Record<
  ChipKind,
  { label: string; placeholder: string; kinds: readonly Search.Kind[] }
> = {
  builds: { label: 'Builds', placeholder: 'Search builds', kinds: ['builds'] },
  branches: { label: 'Branches', placeholder: 'Search branches', kinds: ['branches'] },
  screenshots: {
    label: 'Screenshots',
    placeholder: 'Search screenshots',
    kinds: ['snapshots', 'baselines'],
  },
  baselines: { label: 'Baselines', placeholder: 'Search baselines', kinds: ['baselines'] },
  triage: { label: 'Triage', placeholder: 'Search triage', kinds: ['triage'] },
  notices: { label: 'Inbox', placeholder: 'Search your inbox', kinds: ['notifications'] },
  reviews: { label: 'Review requests', placeholder: 'Search review requests', kinds: ['reviews'] },
  views: { label: 'Saved views', placeholder: 'Search saved views', kinds: ['views'] },
  projects: { label: 'Projects', placeholder: 'Search projects', kinds: ['projects'] },
  people: { label: 'People', placeholder: 'Search people', kinds: ['people'] },
  commands: { label: 'Commands', placeholder: 'Run a command', kinds: [] },
}

const PREFIXES: Record<string, ChipKind> = {
  '#': 'builds',
  '/': 'screenshots',
  '>': 'commands',
  '@': 'people',
}

/** The character that types a kind chip, for a recent search that restores it. */
export const prefixOf = (kind: ChipKind): string =>
  Object.entries(PREFIXES).find(([, k]) => k === kind)?.[0] ?? ''

export const ROOT_PLACEHOLDER = 'Search or type a command'

export const chipLabel = (chip: Chip): string =>
  chip.type === 'project' ? chip.name : KIND_CHIPS[chip.kind].label

export const sameChip = (a: Chip, b: Chip): boolean =>
  a.type === 'project'
    ? b.type === 'project' && a.slug === b.slug
    : b.type === 'kind' && a.kind === b.kind

/** The kind chip among the chips, if any. */
export const kindChip = (chips: readonly Chip[]): ChipKind | undefined =>
  chips.find((c): c is Extract<Chip, { type: 'kind' }> => c.type === 'kind')?.kind

export const projectChip = (
  chips: readonly Chip[],
): Extract<Chip, { type: 'project' }> | undefined =>
  chips.find((c): c is Extract<Chip, { type: 'project' }> => c.type === 'project')

/** The field's placeholder: a kind chip names what is searched. */
export const placeholderFor = (chips: readonly Chip[]): string => {
  const kind = kindChip(chips)
  return kind ? KIND_CHIPS[kind].placeholder : ROOT_PLACEHOLDER
}

/** The project a name or slug names (exactly, ignoring case). */
export function findProject<T extends { slug: string; name: string }>(
  projects: readonly T[] | undefined,
  text: string,
): T | undefined {
  const needle = text.toLowerCase()
  return (projects ?? []).find(
    (t) => t.slug.toLowerCase() === needle || t.name.toLowerCase() === needle,
  )
}

const PROJECT_TOKEN = /(?:^|\s)(?:in|project):(\S+)\s/i
const OPEN_PROJECT_TOKEN = /(?:^|\s)(?:in|project):(\S*)$/i

export interface Typed {
  chips: Chip[]
  text: string
}

/**
 * The chips and text after `value` was typed. A prefix as the first character becomes a kind chip
 * (when there is none yet); a finished `in:name ` / `project:name ` that names a project becomes a project
 * chip (when there is none yet). Anything else stays in the text.
 */
export function readTyped(
  value: string,
  chips: readonly Chip[],
  projects: readonly { slug: string; name: string }[] | undefined,
): Typed {
  let text = value
  const next = [...chips]
  const first = text.charAt(0)
  const prefixed = PREFIXES[first]
  if (prefixed && kindChip(next) === undefined) {
    next.push({ type: 'kind', kind: prefixed })
    text = text.slice(1)
  }
  if (projectChip(next) === undefined) {
    const match = PROJECT_TOKEN.exec(text)
    const project = match?.[1] === undefined ? undefined : findProject(projects, match[1])
    if (match && project) {
      next.unshift({ type: 'project', slug: project.slug, name: project.name })
      const before = text.slice(0, match.index).trimStart()
      const after = text.slice(match.index + match[0].length)
      text = [before.trimEnd(), after].filter(Boolean).join(' ')
    }
  }
  return { chips: next, text }
}

/** Tab on an unfinished `in:we`: the project it starts, as a chip, and the text without the token. */
export function completeProjectToken(
  text: string,
  chips: readonly Chip[],
  projects: readonly { slug: string; name: string }[] | undefined,
): Typed | undefined {
  if (projectChip(chips) !== undefined) return undefined
  const match = OPEN_PROJECT_TOKEN.exec(text)
  if (!match) return undefined
  const fragment = (match[1] ?? '').toLowerCase()
  const project = (projects ?? []).find(
    (t) => t.slug.toLowerCase().startsWith(fragment) || t.name.toLowerCase().startsWith(fragment),
  )
  if (!project) return undefined
  return {
    chips: [{ type: 'project', slug: project.slug, name: project.name }, ...chips],
    text: text.slice(0, match.index).trimEnd(),
  }
}

/** The chips without the last one added (Backspace in the empty field); the kind chip goes before the project chip. */
export function withoutLastChip(chips: readonly Chip[]): Chip[] {
  const kind = chips.findLastIndex((c) => c.type === 'kind')
  const index = kind >= 0 ? kind : chips.length - 1
  return chips.filter((_, i) => i !== index)
}
