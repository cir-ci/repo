import type { Search, Sidebar, View } from '@circi/api'

import {
  type GoTarget,
  SHORTCUTS,
  type Shortcut,
  type ShortcutAction,
  type ShortcutScope,
} from '#lib/shortcuts.ts'

/**
 * The command menu without a DOM: what it lists for an empty query (jump-to entries and the
 * registry's actions in context), how a typed query is read, how search results are ranked and
 * grouped, and how the arrow keys move. Actions and their key hints come from `SHORTCUTS`, so
 * a shortcut is declared once.
 */

export const GROUP_ORDER = [
  'Actions',
  'Jump to',
  'Builds',
  'Branches',
  'Projects',
  'Snapshots',
] as const
export type EntryGroup = (typeof GROUP_ORDER)[number]

/** What a quick look (→) shows: what the search result already knows. */
export interface Preview {
  title: string
  rows: { label: string; value: string }[]
}

/** What choosing an entry does: go to an address, or press a registry key (for a registry action). */
export type Target = { type: 'path'; path: string } | { type: 'key'; key: string }

export interface Entry {
  id: string
  group: EntryGroup
  label: string
  /** Grey text after the label (the project of a build). */
  detail?: string
  /** The registry key spec shown as caps (`g i`, `mod+shift+c`). */
  hint?: string
  target: Target
  preview?: Preview
}

/** The build number a query asks for: `#148` and `148` (spaces allowed), nothing else. */
export function parseBuildQuery(query: string): number | undefined {
  const match = /^#?\s*(\d{1,9})$/.exec(query.trim())
  return match?.[1] === undefined ? undefined : Number(match[1])
}

/** The text sent to the search route: trimmed; empty means "show the empty-query contents". */
export const normalizeQuery = (query: string): string => query.trim()

/** The index after `delta` steps, wrapping at both ends; -1 when there is nothing to pick. */
export function wrapIndex(length: number, current: number, delta: 1 | -1): number {
  if (length === 0) return -1
  if (current < 0) return delta > 0 ? 0 : length - 1
  return (current + delta + length) % length
}

// Paths ----------------------------------------------------------------------------------

const enc = encodeURIComponent
const projectPath = (org: string, project: string) => `/${enc(org)}/${enc(project)}`
export const buildPath = (org: string, project: string, number: number) =>
  `${projectPath(org, project)}/builds/${number}`

// Context ----------------------------------------------------------------------------------

/** The shortcut scopes that apply on a page: the build review, the inbox, or a list of rows. */
export function contextScopes(pathname: string): ShortcutScope[] {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 4 && parts[2] === 'builds') return ['build-review']
  if (parts[0] === 'inbox') return ['inbox', 'list']
  if (parts[0] === 'account' || parts.length === 0) return []
  return ['list']
}

/** The registry actions worth a menu entry: the ones that do something to the thing on screen. */
const MENU_ACTIONS: ReadonlySet<ShortcutAction['type']> = new Set([
  'approve',
  'reject',
  'requestReview',
  'comment',
  'snooze',
  'toggleRead',
  'remove',
  'copyLink',
])

const entryOfShortcut = (s: Shortcut): Entry => ({
  id: `action:${s.key}`,
  group: 'Actions',
  label: s.description,
  hint: s.key,
  target: { type: 'key', key: s.key },
})

/** The registry's actions for this page, in registry order. */
export function contextActions(pathname: string): Entry[] {
  const scopes = new Set<ShortcutScope>([...contextScopes(pathname), 'global'])
  return SHORTCUTS.filter((s) => scopes.has(s.scope) && MENU_ACTIONS.has(s.action.type)).map(
    entryOfShortcut,
  )
}

// Jump to ----------------------------------------------------------------------------------

const goHint = (to: GoTarget) =>
  SHORTCUTS.find((s) => s.action.type === 'go' && s.action.to === to)?.key

export interface JumpInput {
  org: string | undefined
  projects: readonly Sidebar.Project[] | undefined
  views: readonly View.Item[] | undefined
}

const page = (id: string, label: string, path: string, to?: GoTarget): Entry => {
  const hint = to ? goHint(to) : undefined
  return {
    id: `jump:${id}`,
    group: 'Jump to',
    label,
    ...(hint ? { hint } : {}),
    target: { type: 'path', path },
  }
}

/** Pages, the pinned projects and the saved views. */
export function jumpEntries({ org, projects, views }: JumpInput): Entry[] {
  const entries: Entry[] = [page('inbox', 'Inbox', '/inbox', 'inbox')]
  if (org) {
    entries.push(page('reviews', 'Reviews', `/organizations/${enc(org)}/reviews`, 'reviews'))
  }
  entries.push(page('projects', 'Projects', '/', 'projects'))
  if (org) {
    entries.push(page('insights', 'Insights', `/organizations/${enc(org)}/insights`))
    entries.push(page('settings', 'Settings', `/organizations/${enc(org)}/settings`, 'settings'))
  } else {
    entries.push(page('settings', 'Settings', '/account', 'settings'))
  }
  if (org) {
    for (const p of (projects ?? []).filter((project) => project.pinned)) {
      entries.push({
        id: `project:${p.slug}`,
        group: 'Jump to',
        label: p.name,
        detail: 'Pinned project',
        target: { type: 'path', path: projectPath(org, p.slug) },
      })
    }
    for (const v of views ?? []) {
      entries.push({
        id: `view:${v.id}`,
        group: 'Jump to',
        label: v.name,
        detail: 'Saved view',
        target: { type: 'path', path: `/organizations/${enc(org)}/views/${enc(v.id)}` },
      })
    }
  }
  return entries
}

/** What the menu lists before anything is typed: the page's actions, then where to jump. */
export function emptyQueryEntries(pathname: string, jump: JumpInput): Entry[] {
  return [...contextActions(pathname), ...jumpEntries(jump)]
}

// Search results ---------------------------------------------------------------------------

const REVIEW_LABEL: Record<Search.Build['reviewStatus'], string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const buildEntry = (org: string, b: Search.Build): Entry => ({
  id: `build:${b.projectSlug}:${b.number}`,
  group: 'Builds',
  label: `#${b.number} ${b.name}`.trim(),
  detail: [b.projectName, b.branch, b.prNumber === null ? null : `PR #${b.prNumber}`]
    .filter(Boolean)
    .join(' · '),
  target: { type: 'path', path: buildPath(org, b.projectSlug, b.number) },
  preview: {
    title: `#${b.number} ${b.name}`.trim(),
    rows: [
      { label: 'Project', value: b.projectName },
      ...(b.branch ? [{ label: 'Branch', value: b.branch }] : []),
      ...(b.prNumber === null ? [] : [{ label: 'Pull request', value: `#${b.prNumber}` }]),
      { label: 'Build', value: b.status },
      { label: 'Review', value: REVIEW_LABEL[b.reviewStatus] },
    ],
  },
})

/**
 * Search results as entries, in group order. A query that is a build number puts the builds
 * numbered so first, ahead of those that only match as a pull request; and when a project is
 * open, jumps straight to that build there even before the answer arrives.
 */
export function searchEntries(
  org: string,
  query: string,
  results: Search.Results | undefined,
  project?: { slug: string; name: string },
): Entry[] {
  const number = parseBuildQuery(query)
  const builds = (results?.builds ?? []).toSorted(
    (a, b) => Number(b.number === number) - Number(a.number === number),
  )
  const entries: Entry[] = builds.map((b) => buildEntry(org, b))
  if (
    number !== undefined &&
    project &&
    !builds.some((b) => b.projectSlug === project.slug && b.number === number)
  ) {
    entries.unshift({
      id: `build:${project.slug}:${number}`,
      group: 'Builds',
      label: `Build #${number}`,
      detail: project.name,
      target: { type: 'path', path: buildPath(org, project.slug, number) },
    })
  }
  for (const b of results?.branches ?? []) {
    entries.push({
      id: `branch:${b.projectSlug}:${b.branch}`,
      group: 'Branches',
      label: b.branch,
      detail: b.projectName,
      target: { type: 'path', path: buildPath(org, b.projectSlug, b.latestBuildNumber) },
      preview: {
        title: b.branch,
        rows: [
          { label: 'Project', value: b.projectName },
          { label: 'Latest build', value: `#${b.latestBuildNumber}` },
        ],
      },
    })
  }
  for (const p of results?.projects ?? []) {
    entries.push({
      id: `project:${p.slug}`,
      group: 'Projects',
      label: p.name,
      target: { type: 'path', path: projectPath(org, p.slug) },
      preview: { title: p.name, rows: [{ label: 'Slug', value: p.slug }] },
    })
  }
  for (const s of results?.snapshots ?? []) {
    entries.push({
      id: `snapshot:${s.projectSlug}:${s.name}`,
      group: 'Snapshots',
      label: s.name,
      detail: s.projectName,
      target: {
        type: 'path',
        path: `${buildPath(org, s.projectSlug, s.latestBuildNumber)}?shot=${enc(s.name)}`,
      },
      preview: {
        title: s.name,
        rows: [
          { label: 'Project', value: s.projectName },
          { label: 'Latest build', value: `#${s.latestBuildNumber}` },
        ],
      },
    })
  }
  return entries
}

export interface EntryGroupView {
  group: EntryGroup
  entries: Entry[]
}

/** Entries under their group headings, in `GROUP_ORDER`; empty groups are left out. */
export function groupEntries(entries: readonly Entry[]): EntryGroupView[] {
  return GROUP_ORDER.map((group) => ({
    group,
    entries: entries.filter((e) => e.group === group),
  })).filter((g) => g.entries.length > 0)
}

/** The entries in the order the list shows them (group by group), which is the order the arrows walk. */
export const flatten = (groups: readonly EntryGroupView[]): Entry[] =>
  groups.flatMap((g) => g.entries)

// Running a registry action ---------------------------------------------------------------

/** The key presses that make the shortcut layer run a registry key spec (`mod+shift+c`, `g i`). */
export function keyEvents(spec: string): KeyboardEventInit[] {
  return spec.split(' ').map((token) => {
    const parts = token.split('+')
    const rawKey = parts.at(-1) ?? ''
    const mods = new Set(parts.slice(0, -1))
    const key = rawKey === 'space' ? ' ' : rawKey
    const shift = mods.has('shift')
    return {
      key: shift && key.length === 1 ? key.toUpperCase() : key,
      metaKey: mods.has('mod'),
      shiftKey: shift,
      bubbles: true,
    }
  })
}
