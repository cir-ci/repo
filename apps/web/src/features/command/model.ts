import type { Search, Sidebar, View } from '@circi/api'
import type { ColorMode } from '@circi/ui'

import { workspaceSettingsPath } from '#app/shell-model.ts'
import { SHORTCUTS, type Shortcut } from '#lib/shortcuts.ts'

/**
 * The command menu without a DOM: what it lists for an empty query (jump-to entries and the
 * registry's actions in context), how a typed query is read, how search results are ranked and
 * grouped, and how the arrow keys move. Actions and their key hints come from `SHORTCUTS`, so
 * a shortcut is declared once.
 */

export const GROUP_ORDER = [
  'Actions',
  'Jump to',
  'Preferences',
  'Builds',
  'Branches',
  'Teams',
  'Screenshots',
] as const

export interface Entry {
  id: string
  group: Entry.Group
  label: string
  /** Grey text after the label (the team of a build). */
  detail?: string
  /** The registry key spec shown as caps (`g i`, `mod+shift+c`). */
  hint?: string
  target: Entry.Target
  preview?: Entry.Preview
}

export namespace Entry {
  export type Group = (typeof GROUP_ORDER)[number]

  /** What a quick look (→) shows: what the search result already knows. */
  export interface Preview {
    title: string
    rows: { label: string; value: string }[]
  }

  export type Target =
    | { type: 'path'; path: string }
    | { type: 'key'; key: string }
    | { type: 'theme'; mode: ColorMode }

  /** An entry group with its entries, as the list shows it. */
  export interface GroupView {
    group: Group
    entries: Entry[]
  }
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
const teamPath = (workspace: string, team: string) => `/${enc(workspace)}/${enc(team)}`
export const buildPath = (workspace: string, team: string, number: number) =>
  `${teamPath(workspace, team)}/builds/${number}`

// Context ----------------------------------------------------------------------------------

/** The shortcut scopes that apply on a page: the build review, the inbox, or a list of rows. */
export function contextScopes(pathname: string): Shortcut.Scope[] {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 4 && parts[2] === 'builds') return ['build-review']
  if (parts[0] === 'inbox') return ['inbox', 'list']
  if (parts[0] === 'account' || parts.length === 0) return []
  return ['list']
}

/** The registry actions worth a menu entry: the ones that do something to the thing on screen. */
const MENU_ACTIONS: ReadonlySet<Shortcut.Action['type']> = new Set([
  'approve',
  'approveAll',
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

/**
 * Whether anything on the page handles this action. Most list actions work on a list of rows
 * wherever one is; snooze and request review need a selected item to act on, so they are only
 * offered where a page binds them (a menu entry that does nothing is worse than none).
 */
function appliesOn(type: Shortcut.Action['type'], pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  const onBuild = parts.length === 4 && parts[2] === 'builds'
  const onReviews = parts[0] === 'workspaces' && parts[2] === 'reviews'
  if (type === 'requestReview') return onBuild || onReviews
  if (type === 'snooze') {
    return onReviews || parts[0] === 'inbox' || (parts.length === 3 && parts[2] === 'triage')
  }
  return true
}

/** The registry's actions for this page, in registry order. */
export function contextActions(pathname: string): Entry[] {
  const scopes = new Set<Shortcut.Scope>([...contextScopes(pathname), 'global'])
  const onBuild = scopes.has('build-review')
  return SHORTCUTS.filter(
    (s) =>
      // Request review is declared for lists, and works on the build page too.
      (scopes.has(s.scope) || (onBuild && s.action.type === 'requestReview')) &&
      MENU_ACTIONS.has(s.action.type) &&
      appliesOn(s.action.type, pathname),
  ).map(entryOfShortcut)
}

// Jump to ----------------------------------------------------------------------------------

const goHint = (to: Shortcut.GoTarget) =>
  SHORTCUTS.find((s) => s.action.type === 'go' && s.action.to === to)?.key

export interface JumpInput {
  workspace: string | undefined
  teams: readonly Sidebar.Team[] | undefined
  views: readonly View.Item[] | undefined
  canManage?: boolean | undefined
}

const page = (id: string, label: string, path: string, to?: Shortcut.GoTarget): Entry => {
  const hint = to ? goHint(to) : undefined
  return {
    id: `jump:${id}`,
    group: 'Jump to',
    label,
    ...(hint ? { hint } : {}),
    target: { type: 'path', path },
  }
}

/** Pages, the pinned teams and the saved views. */
export function jumpEntries({ workspace, teams, views, canManage }: JumpInput): Entry[] {
  const entries: Entry[] = [page('inbox', 'Inbox', '/inbox', 'inbox')]
  if (workspace) {
    entries.push(page('reviews', 'Reviews', `/workspaces/${enc(workspace)}/reviews`, 'reviews'))
  }
  entries.push(page('teams', 'Teams', '/', 'teams'))
  if (workspace) {
    entries.push(page('insights', 'Insights', `/workspaces/${enc(workspace)}/insights`))
    entries.push(
      page('settings', 'Settings', workspaceSettingsPath(workspace, canManage), 'settings'),
    )
  } else {
    entries.push(page('settings', 'Settings', '/account', 'settings'))
  }
  if (workspace) {
    for (const p of (teams ?? []).filter((team) => team.pinned)) {
      entries.push({
        id: `team:${p.slug}`,
        group: 'Jump to',
        label: p.name,
        detail: 'Pinned team',
        target: { type: 'path', path: teamPath(workspace, p.slug) },
      })
    }
    for (const v of views ?? []) {
      entries.push({
        id: `view:${v.id}`,
        group: 'Jump to',
        label: v.name,
        detail: 'Saved view',
        target: { type: 'path', path: `/workspaces/${enc(workspace)}/views/${enc(v.id)}` },
      })
    }
  }
  return entries
}

// Preferences ------------------------------------------------------------------------------

const THEMES: { mode: ColorMode; label: string }[] = [
  { mode: 'system', label: 'Theme: System' },
  { mode: 'light', label: 'Theme: Light' },
  { mode: 'dark', label: 'Theme: Dark' },
]

/** The theme choices; the one in use says so. */
export const themeEntries = (current: ColorMode): Entry[] =>
  THEMES.map((t) => {
    const entry: Entry = {
      id: `theme:${t.mode}`,
      group: 'Preferences',
      label: t.label,
      target: { type: 'theme', mode: t.mode },
    }
    if (t.mode === current) entry.detail = 'Current'
    return entry
  })

/** What the menu lists before anything is typed: the page's actions, where to jump, the theme. */
export function emptyQueryEntries(pathname: string, jump: JumpInput, theme: ColorMode): Entry[] {
  return [...contextActions(pathname), ...jumpEntries(jump), ...themeEntries(theme)]
}

/**
 * The menu's own entries (actions, pages, theme) whose label holds every word typed, so a query
 * finds commands as well as what the search route returns.
 */
export function localMatches(
  query: string,
  pathname: string,
  jump: JumpInput,
  theme: ColorMode,
): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return emptyQueryEntries(pathname, jump, theme).filter((e) => {
    const label = e.label.toLowerCase()
    return words.every((w) => label.includes(w))
  })
}

// Search results ---------------------------------------------------------------------------

const REVIEW_LABEL: Record<Search.Build['reviewStatus'], string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const buildEntry = (workspace: string, b: Search.Build): Entry => ({
  id: `build:${b.teamSlug}:${b.number}`,
  group: 'Builds',
  label: `#${b.number} ${b.name}`.trim(),
  detail: [b.teamName, b.branch, b.prNumber === null ? null : `PR #${b.prNumber}`]
    .filter(Boolean)
    .join(' · '),
  target: { type: 'path', path: buildPath(workspace, b.teamSlug, b.number) },
  preview: {
    title: `#${b.number} ${b.name}`.trim(),
    rows: [
      { label: 'Team', value: b.teamName },
      ...(b.branch ? [{ label: 'Branch', value: b.branch }] : []),
      ...(b.prNumber === null ? [] : [{ label: 'Pull request', value: `#${b.prNumber}` }]),
      { label: 'Build', value: b.status },
      { label: 'Review', value: REVIEW_LABEL[b.reviewStatus] },
    ],
  },
})

/**
 * Search results as entries, in group order. A query that is a build number puts the builds
 * numbered so first, ahead of those that only match as a pull request; and when a team is
 * open, jumps straight to that build there even before the answer arrives.
 */
export function searchEntries(
  workspace: string,
  query: string,
  results: Search.Results | undefined,
  team?: { slug: string; name: string },
): Entry[] {
  const number = parseBuildQuery(query)
  const builds = (results?.builds ?? []).toSorted(
    (a, b) => Number(b.number === number) - Number(a.number === number),
  )
  const entries: Entry[] = builds.map((b) => buildEntry(workspace, b))
  if (
    number !== undefined &&
    team &&
    !builds.some((b) => b.teamSlug === team.slug && b.number === number)
  ) {
    entries.unshift({
      id: `build:${team.slug}:${number}`,
      group: 'Builds',
      label: `Build #${number}`,
      detail: team.name,
      target: { type: 'path', path: buildPath(workspace, team.slug, number) },
    })
  }
  for (const b of results?.branches ?? []) {
    entries.push({
      id: `branch:${b.teamSlug}:${b.branch}`,
      group: 'Branches',
      label: b.branch,
      detail: b.teamName,
      target: { type: 'path', path: buildPath(workspace, b.teamSlug, b.latestBuildNumber) },
      preview: {
        title: b.branch,
        rows: [
          { label: 'Team', value: b.teamName },
          { label: 'Latest build', value: `#${b.latestBuildNumber}` },
        ],
      },
    })
  }
  for (const p of results?.teams ?? []) {
    entries.push({
      id: `team:${p.slug}`,
      group: 'Teams',
      label: p.name,
      target: { type: 'path', path: teamPath(workspace, p.slug) },
      preview: { title: p.name, rows: [{ label: 'Slug', value: p.slug }] },
    })
  }
  for (const s of results?.snapshots ?? []) {
    entries.push({
      id: `snapshot:${s.teamSlug}:${s.name}`,
      group: 'Screenshots',
      label: s.name,
      detail: s.teamName,
      target: {
        type: 'path',
        path: `${buildPath(workspace, s.teamSlug, s.latestBuildNumber)}?shot=${enc(s.name)}`,
      },
      preview: {
        title: s.name,
        rows: [
          { label: 'Team', value: s.teamName },
          { label: 'Latest build', value: `#${s.latestBuildNumber}` },
        ],
      },
    })
  }
  return entries
}

/** Entries under their group headings, in `GROUP_ORDER`; empty groups are left out. */
export function groupEntries(entries: readonly Entry[]): Entry.GroupView[] {
  return GROUP_ORDER.map((group) => ({
    group,
    entries: entries.filter((e) => e.group === group),
  })).filter((g) => g.entries.length > 0)
}

/** The entries in the order the list shows them (group by group), which is the order the arrows walk. */
export const flatten = (groups: readonly Entry.GroupView[]): Entry[] =>
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
