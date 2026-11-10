import type { Search, Sidebar, View } from '@circi/api'
import type { ColorMode } from '@circi/ui'

import { goPath, type WorkspaceRef } from '#app/shell-model.ts'
import { SHORTCUTS, type Shortcut } from '#lib/shortcuts.ts'
import type { RecentEntry } from '#lib/stores/recent-store.ts'

import { type Chip, type ChipKind, type Entry, type IconKey, verbOf } from './entry.ts'
import { KIND_CHIPS, kindChip, prefixOf, teamChip } from './query.ts'
import { shortAgo } from './recent.ts'
import {
  GROUP_KIND,
  jumpBuildEntry,
  KIND_NOUN,
  RESULT_GROUPS,
  resultEntries,
  type ResultsContext,
} from './results.ts'
import {
  IN_SETTINGS,
  LEAVE_PATH,
  LEAVE_SETTINGS,
  matchesSettings,
  sectionEntry,
  type SettingsInput,
  settingsSections,
} from './settings.ts'

/**
 * The command menu without a DOM: what it lists for an empty query (the page's actions, Recent,
 * what needs you, where to go, what to switch), how typed text is read and ranked, how a long
 * group is cut, and how the arrow keys move. Actions and their keys come from `SHORTCUTS`, so a
 * shortcut is declared once.
 */

// Group names ----------------------------------------------------------------------------

export const GROUPS = {
  actions: 'Actions',
  goTo: 'Go to',
  recent: 'Recent',
  needs: 'Needs you',
  switch: 'Switch and change',
  settings: 'Settings',
  people: 'People',
} as const

/** The order groups stand in when their best matches are equally good (the spec's list). */
const TIE_ORDER: readonly string[] = [
  GROUPS.actions,
  GROUPS.goTo,
  ...RESULT_GROUPS,
  GROUPS.settings,
]

/** The most rows one group of results shows before `Show all N …`. */
export const GROUP_CAP = 3
/** How many page actions the empty query lists. */
const PAGE_ACTIONS_MAX = 6
/** How many recents the empty query lists (the store keeps more). */
const RECENT_SHOWN = 5

// Small helpers --------------------------------------------------------------------------

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

const enc = encodeURIComponent
const teamPath = (workspace: string, team: string) => `/${enc(workspace)}/${enc(team)}`
export { buildPath } from './results.ts'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Page context -----------------------------------------------------------------------------

/** The shortcut scopes that apply on a page: the build review, the inbox, or a list of rows. */
export function contextScopes(pathname: string): Shortcut.Scope[] {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 4 && parts[2] === 'builds') return ['build-review']
  if (parts[0] === 'inbox') return ['inbox', 'list']
  if (parts[0] === 'account' || parts.length === 0) return []
  return ['list']
}

/** What the page you are on gives the menu: the chip, the team it scopes search to, the page's name. */
export interface PageContext {
  /** The chip beside the field (`Web app · #148`); only a team's pages have one. */
  chip?: string
  team?: { slug: string; name: string }
  /** The heading of the page's own actions (`Build #148`, `Reviews`). */
  heading?: string
  /** The build on screen. */
  buildNumber?: number
}

const decode = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

const NOT_A_WORKSPACE = new Set(['workspaces', 'account', 'instance', 'inbox', '_sso'])

export function pageContext(
  pathname: string,
  teams: readonly Pick<Sidebar.Team, 'slug' | 'name'>[] | undefined,
  routeWorkspace?: string,
  workspace?: string,
): PageContext {
  const parts = pathname.split('/').filter(Boolean)
  const first = parts[0]
  if (first === undefined) return { heading: 'Teams' }
  if (first === 'inbox') return { heading: 'Inbox' }
  if (first === 'workspaces') {
    if (parts[2] === 'reviews') return { heading: 'Reviews' }
    if (parts[2] === 'insights') return { heading: 'Insights' }
    return {}
  }
  if (NOT_A_WORKSPACE.has(first) || parts[1] === undefined) return {}
  // A team of another workspace than the one the menu is about scopes nothing.
  if (routeWorkspace !== undefined && workspace !== undefined && routeWorkspace !== workspace)
    return {}
  const slug = decode(parts[1])
  const team = { slug, name: teams?.find((t) => t.slug === slug)?.name ?? slug }
  const section = parts[2]
  if (section === 'builds' && parts[3] !== undefined && parts.length === 4) {
    return {
      team,
      chip: `${team.name} · #${parts[3]}`,
      heading: `Build #${parts[3]}`,
      buildNumber: Number(parts[3]),
    }
  }
  if (section === 'triage') return { team, chip: team.name, heading: 'Triage' }
  if (section === 'baselines' && parts.length > 3) {
    return {
      team,
      chip: team.name,
      heading: `Baseline: ${parts.slice(3).map(decode).join(' / ')}`,
    }
  }
  return { team, chip: team.name, heading: 'Builds' }
}

// Registry actions -------------------------------------------------------------------------

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

/** The verbs the menu uses, where they differ from the shortcuts help. */
const ACTION_LABEL: Partial<Record<Shortcut.Action['type'], string>> = {
  approve: 'Approve screenshot',
  approveAll: 'Approve all',
  reject: 'Reject screenshot',
  requestReview: 'Request review',
  comment: 'Write a comment',
  copyLink: 'Copy link to this page',
  snooze: 'Snooze…',
  toggleRead: 'Mark as read',
  remove: 'Remove',
}

const ACTION_ICON: Partial<Record<Shortcut.Action['type'], IconKey>> = {
  approve: 'approve',
  approveAll: 'approve',
  reject: 'reject',
  requestReview: 'person',
  comment: 'comment',
  snooze: 'snooze',
  toggleRead: 'check',
  remove: 'remove',
  copyLink: 'copy',
  help: 'keyboard',
}

const ACTION_WORDS: Partial<Record<Shortcut.Action['type'], string[]>> = {
  approve: ['approve', 'accept', 'lgtm'],
  approveAll: ['approve', 'accept'],
  reject: ['reject', 'decline'],
  requestReview: ['review', 'ask'],
  comment: ['comment', 'reply'],
  copyLink: ['copy', 'link', 'url', 'share'],
  snooze: ['snooze', 'later'],
  toggleRead: ['read', 'unread'],
  remove: ['delete', 'remove'],
}

/** What an action will do, to what: the peek of an action row. */
function actionLine(type: Shortcut.Action['type'], page: PageContext, changed?: number): string {
  const build = page.buildNumber === undefined ? 'this build' : `build #${page.buildNumber}`
  switch (type) {
    case 'approve':
      return `Approves the screenshot you are looking at in ${build}.`
    case 'approveAll':
      return changed === undefined
        ? `Approves all changed screenshots in ${build}.`
        : `Approves all ${count(changed, 'changed screenshot', 'changed screenshots')} in ${build}.`
    case 'reject':
      return `Rejects the screenshot you are looking at in ${build}, with a reason.`
    case 'requestReview':
      return `Asks someone to review ${page.buildNumber === undefined ? 'the selected item' : build}.`
    case 'comment':
      return `Starts a comment on ${build}.`
    case 'snooze':
      return 'Snoozes the selected item until you choose.'
    case 'toggleRead':
      return 'Marks the selected notice as read, or as unread when it is read.'
    case 'remove':
      return 'Removes the selected notice from your inbox.'
    case 'copyLink':
      return 'Copies the link to this page.'
    default:
      return 'Runs on the page you came from.'
  }
}

function actionEntry(
  s: Shortcut,
  page: PageContext,
  changed?: number,
  group: string = GROUPS.actions,
): Entry {
  const label = ACTION_LABEL[s.action.type] ?? s.description
  return {
    id: `action:${s.key}`,
    group,
    kind: 'action',
    label,
    hint: s.key,
    icon: ACTION_ICON[s.action.type] ?? 'check',
    target: { type: 'key', key: s.key },
    keywords: ACTION_WORDS[s.action.type] ?? [],
    peek: {
      kind: 'Action',
      title: label,
      lines: [actionLine(s.action.type, page, changed)],
      rows: [],
    },
  }
}

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
export function contextActions(
  pathname: string,
  page: PageContext = {},
  changed?: number,
  group: string = GROUPS.actions,
): Entry[] {
  const scopes = new Set<Shortcut.Scope>([...contextScopes(pathname), 'global'])
  const onBuild = scopes.has('build-review')
  return SHORTCUTS.filter(
    (s) =>
      // Request review is declared for lists, and works on the build page too.
      (scopes.has(s.scope) || (onBuild && s.action.type === 'requestReview')) &&
      MENU_ACTIONS.has(s.action.type) &&
      appliesOn(s.action.type, pathname),
  ).map((s) => actionEntry(s, page, changed, group))
}

// Go to ------------------------------------------------------------------------------------

const goHint = (to: Shortcut.GoTarget) =>
  SHORTCUTS.find((s) => s.action.type === 'go' && s.action.to === to)?.key

const PAGE_LINES: Record<string, string> = {
  inbox: 'Your notices: mentions, review requests and decisions on your builds.',
  reviews: "Reviews you're asked for and ones you asked.",
  triage: "The team's flaky screenshots, missing baselines and failed builds.",
  teams: 'Every team you can see, and a way to create one.',
  insights: 'How reviews and builds have gone over time.',
  settings: 'Your account, the workspace and its teams.',
}

export interface JumpInput {
  workspace: string | undefined
  teams: readonly Sidebar.Team[] | undefined
  views: readonly View.Item[] | undefined
  canManage?: boolean | undefined
  /** The team of the address, which the Triage page opens. */
  routeTeam?: string | undefined
}

function pageEntry(
  id: string,
  label: string,
  path: string,
  icon: IconKey,
  to?: Shortcut.GoTarget,
): Entry {
  const hint = to ? goHint(to) : undefined
  return {
    id: `page:${id}`,
    group: GROUPS.goTo,
    kind: 'page',
    label,
    ...(hint ? { hint } : {}),
    icon,
    target: { type: 'path', path },
    path,
    peek: { kind: 'Page', title: label, lines: [PAGE_LINES[id] ?? ''], rows: [] },
  }
}

/** Pages, then the pinned teams and the saved views, under Go to. */
export function goToEntries({ workspace, teams, views, canManage, routeTeam }: JumpInput): Entry[] {
  const entries: Entry[] = [pageEntry('inbox', 'Inbox', '/inbox', 'inbox', 'inbox')]
  if (workspace) {
    const ws = enc(workspace)
    entries.push(pageEntry('reviews', 'Reviews', `/workspaces/${ws}/reviews`, 'reviews', 'reviews'))
    const triage = goPath('triage', { workspace, team: routeTeam, teams, canManage })
    if (triage) entries.push(pageEntry('triage', 'Triage', triage, 'triage', 'triage'))
  }
  entries.push(pageEntry('teams', 'Teams', '/', 'teams', 'teams'))
  if (workspace) {
    entries.push(
      pageEntry('insights', 'Insights', `/workspaces/${enc(workspace)}/insights`, 'insights'),
    )
  }
  const settings = goPath('settings', { workspace, canManage })
  if (settings) entries.push(pageEntry('settings', 'Settings', settings, 'settings', 'settings'))
  if (workspace) {
    for (const p of (teams ?? []).filter((team) => team.pinned)) {
      entries.push(teamEntry(workspace, p, GROUPS.goTo))
    }
    for (const v of views ?? []) {
      const path = `/workspaces/${enc(workspace)}/views/${enc(v.id)}`
      entries.push({
        id: `view:${v.id}`,
        group: GROUPS.goTo,
        kind: 'view',
        label: v.name,
        kindLabel: 'Saved view',
        icon: 'sliders',
        target: { type: 'path', path },
        path,
        peek: { kind: 'Saved view', title: v.name, lines: ['Opens the saved view.'], rows: [] },
      })
    }
  }
  return entries
}

function teamEntry(workspace: string, team: Sidebar.Team, group: string): Entry {
  const path = teamPath(workspace, team.slug)
  return {
    id: `team:${team.slug}`,
    group,
    kind: 'team',
    label: team.name,
    kindLabel: 'Team',
    icon: 'team',
    team: { slug: team.slug, name: team.name, color: team.color, icon: team.icon },
    target: { type: 'path', path },
    path,
    peek: {
      kind: 'Team',
      title: team.name,
      lines: [`Goes to the builds of ${team.name}.`],
      rows: [
        { label: 'Members', value: String(team.memberCount) },
        { label: 'Triage waiting', value: String(team.triage) },
      ],
    },
  }
}

// Switch and change ------------------------------------------------------------------------

const submenu = (
  id: string,
  label: string,
  page: 'team' | 'workspace' | 'theme',
  icon: IconKey,
  keywords: string[],
  line: string,
): Entry => ({
  id: `switch:${id}`,
  group: GROUPS.switch,
  kind: 'submenu',
  label,
  chevron: true,
  icon,
  target: { type: 'page', page },
  keywords,
  peek: { kind: 'Action', title: label, lines: [line], rows: [] },
})

export interface SwitchInput {
  workspace: string | undefined
  teams: readonly Sidebar.Team[] | undefined
  workspaces: readonly WorkspaceRef[]
  /** May change the workspace's settings: then New team and Invite people are offered. */
  canManage?: boolean | undefined
  /** May create workspaces. */
  canCreateWorkspace?: boolean | undefined
}

const create = (
  id: string,
  label: string,
  icon: IconKey,
  target: Entry.Target,
  keywords: string[],
  line: string,
  path?: string,
): Entry => ({
  id: `switch:${id}`,
  group: GROUPS.switch,
  kind: 'action',
  label,
  icon,
  target,
  keywords,
  ...(path ? { path } : {}),
  peek: { kind: 'Action', title: label, lines: [line], rows: [] },
})

/**
 * Switch team…, Switch workspace…, New team, New workspace, Invite people, Theme…, Keyboard
 * shortcuts, Sign out. The Create entries only show where the person may: they open the dialogs
 * the sidebar opens, and Invite people goes to Members, the workspace's invite form (settings
 * pages are never opened from inside the menu otherwise).
 */
export function switchEntries({
  workspace,
  teams,
  workspaces,
  canManage,
  canCreateWorkspace,
}: SwitchInput): Entry[] {
  const entries: Entry[] = []
  if (workspace && (teams?.length ?? 0) > 0) {
    entries.push(
      submenu(
        'team',
        'Switch team…',
        'team',
        'team',
        ['team', 'change'],
        'Choose another team to open.',
      ),
    )
  }
  if (workspaces.length > 1) {
    entries.push(
      submenu(
        'workspace',
        'Switch workspace…',
        'workspace',
        'workspace',
        ['workspace', 'change'],
        'Choose another workspace to open.',
      ),
    )
  }
  if (workspace && canManage) {
    entries.push(
      create(
        'new-team',
        'New team',
        'team',
        { type: 'create', what: 'team' },
        ['create', 'add', 'new'],
        'Opens the New team dialog.',
      ),
    )
  }
  if (canCreateWorkspace) {
    entries.push(
      create(
        'new-workspace',
        'New workspace',
        'workspace',
        { type: 'create', what: 'workspace' },
        ['create', 'add', 'new', 'organisation', 'organization'],
        'Opens the New workspace dialog.',
      ),
    )
  }
  if (workspace && canManage) {
    const path = `/workspaces/${enc(workspace)}/settings/members`
    entries.push(
      create(
        'invite',
        'Invite people',
        'person',
        { type: 'path', path },
        ['invite', 'add', 'member', 'members', 'teammate', 'email'],
        'Goes to Members, where you invite people by email.',
        path,
      ),
    )
  }
  entries.push(
    submenu(
      'theme',
      'Theme…',
      'theme',
      'theme',
      ['prefs', 'preferences', 'appearance', 'dark', 'light', 'system', 'color'],
      'Choose System, Light or Dark.',
    ),
  )
  const help = SHORTCUTS.find((s) => s.action.type === 'help')
  entries.push({
    id: 'pref:shortcuts',
    group: GROUPS.switch,
    kind: 'action',
    label: 'Keyboard shortcuts',
    ...(help ? { hint: help.key } : {}),
    icon: 'keyboard',
    target: { type: 'key', key: help?.key ?? '?' },
    keywords: ['keys', 'help', 'hotkeys'],
    peek: {
      kind: 'Action',
      title: 'Keyboard shortcuts',
      lines: ['Shows every keyboard shortcut.'],
      rows: [],
    },
  })
  entries.push({
    id: 'switch:sign-out',
    group: GROUPS.switch,
    kind: 'action',
    label: 'Sign out',
    icon: 'sign-out',
    target: { type: 'signOut' },
    keywords: ['logout', 'log out'],
    peek: { kind: 'Action', title: 'Sign out', lines: ['Signs you out on this device.'], rows: [] },
  })
  return entries
}

/** The choices of the Theme… list. */
export const THEME_CHOICES: { mode: ColorMode; label: string }[] = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
]

// Needs you and Recent ---------------------------------------------------------------------

export interface Needs {
  reviews: number
  unread: number
  triageAssigned: number
}

function needRow(
  id: string,
  label: string,
  kindLabel: string,
  icon: IconKey,
  path: string,
  line: string,
): Entry {
  return {
    id: `need:${id}`,
    group: GROUPS.needs,
    kind: 'need',
    label,
    kindLabel,
    icon,
    target: { type: 'path', path },
    path,
    peek: { kind: kindLabel, title: label, lines: [line], rows: [] },
  }
}

export function needsEntries(needs: Needs, jump: JumpInput): Entry[] {
  const entries: Entry[] = []
  const { workspace } = jump
  const row = needRow
  if (workspace && needs.reviews > 0) {
    entries.push(
      row(
        'reviews',
        `${count(needs.reviews, 'review', 'reviews')} waiting on you`,
        'Reviews',
        'eye',
        `/workspaces/${enc(workspace)}/reviews?tab=for-you`,
        'Goes to Reviews, to the ones asked of you.',
      ),
    )
  }
  const triage = goPath('triage', {
    workspace,
    team: jump.routeTeam,
    teams: jump.teams,
    canManage: jump.canManage,
  })
  if (needs.triageAssigned > 0 && triage) {
    entries.push(
      row(
        'triage',
        `${count(needs.triageAssigned, 'triage item', 'triage items')} assigned to you`,
        'Triage',
        'alert',
        triage,
        'Goes to the triage queue.',
      ),
    )
  }
  if (needs.unread > 0) {
    entries.push(
      row(
        'inbox',
        count(needs.unread, 'unread notice', 'unread notices'),
        'Inbox',
        'bell',
        '/inbox',
        'Goes to your Inbox.',
      ),
    )
  }
  return entries
}

const RECENT_ICON: Record<RecentEntry['kind'], IconKey> = {
  build: 'status',
  team: 'team',
  baseline: 'layers',
  triage: 'alert',
  view: 'sliders',
}
const RECENT_KIND_LABEL: Record<RecentEntry['kind'], string> = {
  build: 'Build',
  team: 'Team',
  baseline: 'Baseline',
  triage: 'Triage',
  view: 'Saved view',
}

/** The kind of recent entry each kind chip asks for. */
const CHIP_RECENT: Partial<Record<ChipKind, RecentEntry['kind']>> = {
  builds: 'build',
  teams: 'team',
  baselines: 'baseline',
  triage: 'triage',
  views: 'view',
}

function recentEntry(
  r: RecentEntry,
  teams: readonly Sidebar.Team[] | undefined,
  now: number,
): Entry {
  const team = r.kind === 'team' ? teams?.find((t) => `team:${t.slug}` === r.id) : undefined
  return {
    id: `recent:${r.id}`,
    group: GROUPS.recent,
    kind: r.kind,
    label: r.label,
    ...(r.detail ? { detail: r.detail } : {}),
    kindLabel: RECENT_KIND_LABEL[r.kind],
    time: shortAgo(r.at, now),
    icon: RECENT_ICON[r.kind],
    ...(r.kind === 'build' ? { status: 'needs-review' as const } : {}),
    ...(team
      ? { team: { slug: team.slug, name: team.name, color: team.color, icon: team.icon } }
      : {}),
    target: { type: 'path', path: r.path },
    path: r.path,
    peek: {
      kind: RECENT_KIND_LABEL[r.kind],
      title: r.label,
      lines: [`Visited ${shortAgo(r.at, now)}.`],
      rows: r.detail ? [{ label: 'Team', value: r.detail }] : [],
    },
  }
}

export function recentEntries(
  recents: readonly RecentEntry[],
  teams: readonly Sidebar.Team[] | undefined,
  now: number,
  currentPath: string,
  limit = RECENT_SHOWN,
  only?: RecentEntry['kind'],
): Entry[] {
  return recents
    .filter((r) => r.path.split('?')[0] !== currentPath && (only === undefined || r.kind === only))
    .slice(0, limit)
    .map((r) => recentEntry(r, teams, now))
}

/** How many recent searches the empty query lists. */
const SEARCHES_SHOWN = 3

/** Recent searches as rows (choosing one types it again), then the row that forgets them. */
export function searchEntries(searches: readonly string[]): Entry[] {
  if (searches.length === 0) return []
  const rows = searches.slice(0, SEARCHES_SHOWN).map((text): Entry => ({
    id: `search:${text}`,
    group: GROUPS.recent,
    kind: 'search',
    label: text,
    kindLabel: 'Search',
    icon: 'search',
    target: { type: 'search', text },
    peek: {
      kind: 'Recent search',
      title: text,
      lines: ['Types it in the field again.'],
      rows: [],
    },
  }))
  return [
    ...rows,
    {
      id: 'search:clear',
      group: GROUPS.recent,
      kind: 'action',
      label: 'Clear recent searches',
      icon: 'remove',
      target: { type: 'clearSearches' },
      keywords: ['forget', 'history'],
      peek: {
        kind: 'Action',
        title: 'Clear recent searches',
        lines: ['Forgets what you searched for in this workspace.'],
        rows: [],
      },
    },
  ]
}

/** The kinds of row that come from a search; choosing one remembers what was typed. */
const FOUND_KINDS: ReadonlySet<Entry['kind']> = new Set([
  'build',
  'branch',
  'screenshot',
  'baseline',
  'triage',
  'notice',
  'review',
  'view',
  'person',
  'team',
])

/**
 * What to remember when `entry` is chosen with `text` typed after `chips`: the text, with the
 * character of its kind chip in front (so it types the same again), or nothing when there is no
 * search to remember (nothing typed, one character, a row that was not found by search).
 */
export function rememberedSearch(
  entry: Pick<Entry, 'id' | 'kind'>,
  chips: readonly Chip[],
  text: string,
): string | undefined {
  const q = text.trim()
  if (q.length < 2 || !FOUND_KINDS.has(entry.kind) || entry.id.startsWith('recent:')) {
    return undefined
  }
  const kind = kindChip(chips)
  return `${kind ? prefixOf(kind) : ''}${q}`
}

// Matching and ranking ---------------------------------------------------------------------

/** The words of typed text, lower case. */
export const wordsOf = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * How well `text` matches the first word: 100 equal, 80 starting with it, 60 a word starting with
 * it, 40 containing it, 0 not at all.
 */
export function textScore(text: string, word: string): number {
  const t = text.toLowerCase()
  if (t === word) return 100
  if (t.startsWith(word)) return 80
  if (new RegExp(`(^|[\\s/_.:#-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 60
  return t.includes(word) ? 40 : 0
}

/** Matches when every word is in the label or a keyword; the score follows the first word. */
export function matchScore(
  entry: Pick<Entry, 'label' | 'keywords'>,
  words: readonly string[],
): number {
  if (words.length === 0) return 0
  let first = 0
  for (const [i, w] of words.entries()) {
    const inLabel = textScore(entry.label, w)
    const inWords = Math.max(0, ...(entry.keywords ?? []).map((k) => Math.min(textScore(k, w), 50)))
    const best = Math.max(inLabel, inWords)
    if (best === 0) return 0
    if (i === 0) first = best
  }
  return first
}

/** How a result scores: its label against the text, else a base score (the server matched it by other fields). */
function resultScore(entry: Entry, words: readonly string[], number: number | undefined): number {
  if (entry.kind === 'build' && number !== undefined) {
    const own = /^#?(\d+)/.exec(entry.label)?.[1]
    if (own !== undefined && Number(own) === number) return 100
    if (entry.label.startsWith('Build #') && entry.label.endsWith(String(number))) return 100
  }
  return Math.max(matchScore(entry, words), 20)
}

// The list ---------------------------------------------------------------------------------

export interface ListInput {
  workspace: string | undefined
  pathname: string
  routeWorkspace: string | undefined
  teams: readonly Sidebar.Team[] | undefined
  views: readonly View.Item[] | undefined
  workspaces: readonly WorkspaceRef[]
  canManage: boolean | undefined
  /** Whether the person may create workspaces. */
  canCreateWorkspace?: boolean | undefined
  instanceAdmin: boolean | undefined
  /** Whether the address is one of settings' pages. */
  inSettings: boolean
  needs: Needs
  recents: readonly RecentEntry[]
  /** What was typed before choosing a result, newest first (this workspace's). */
  searches?: readonly string[] | undefined
  now: number
  /** How many screenshots changed in the build on screen, when it has been loaded. */
  changed?: number | undefined
  /** Where Leave settings goes: the page of the app the person came from (the Inbox without one). */
  leave?: { path: string; label: string } | undefined
}

export interface TypedState {
  /** The text after the chips. */
  query: string
  chips: readonly Chip[]
  /** Whether the page chip was removed (no page actions, no team scope). */
  contextCleared: boolean
  results: Search.Results | undefined
  pending: boolean
  failed: boolean
}

export interface ListView {
  groups: Entry.GroupView[]
  /** The team the search is limited to, by the page or by a chip. */
  scope: { slug: string; name: string } | undefined
  /** What the list says besides rows: searching, nothing found, failed. */
  state: 'results' | 'searching' | 'none' | 'error'
  /** Shown above the rows in the none and error states. */
  message?: string
  /** A second, quieter line (the build number tip). */
  tip?: string
  /** The page chip shows (the page context, not removed and no team chip replacing it). */
  context: PageContext
  showContext: boolean
  inSettings: boolean
  /** The kinds the search route is asked for; undefined: all. Empty: no search (commands only). */
  kinds: readonly Search.Kind[] | undefined
}

/** The team a search is limited to: a team chip, else the page's team unless its chip was removed. */
export function scopeOf(
  input: Pick<ListInput, 'pathname' | 'teams' | 'routeWorkspace' | 'workspace'>,
  chips: readonly Chip[],
  contextCleared: boolean,
): { slug: string; name: string } | undefined {
  const chip = teamChip(chips)
  if (chip) return { slug: chip.slug, name: chip.name }
  if (contextCleared) return undefined
  return pageContext(input.pathname, input.teams, input.routeWorkspace, input.workspace).team
}

export const isReal = (e: Entry) => e.kind !== 'more' && e.kind !== 'widen' && e.kind !== 'retry'

function uniqueBy(entries: readonly Entry[]): Entry[] {
  const seen = new Set<string>()
  return entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

/** Which fifth of the 0 to 100 scale a group's best row is in: groups in a higher one lead. */
const tier = (entries: readonly Entry[]): number =>
  Math.floor(Math.max(0, ...entries.map((e) => e.score ?? 0)) / 20)

export function buildList(input: ListInput, typed: TypedState): ListView {
  const { workspace } = input
  const settingsInput: SettingsInput = {
    workspace,
    canManage: input.canManage,
    instanceAdmin: input.instanceAdmin,
  }
  const kind = kindChip(typed.chips)
  const q = typed.query.trim()
  const words = wordsOf(q)
  const context = pageContext(input.pathname, input.teams, input.routeWorkspace, workspace)
  const hasTeamChip = teamChip(typed.chips) !== undefined
  const showContext = context.chip !== undefined && !typed.contextCleared && !hasTeamChip
  const scope = scopeOf(input, typed.chips, typed.contextCleared)
  const base = {
    scope,
    context,
    showContext,
    kinds: kind ? KIND_CHIPS[kind].kinds : undefined,
  }

  // Settings is a closed area: inside it, settings only, whatever is typed.
  if (input.inSettings) {
    return { ...base, ...settingsList(input, settingsInput, words), inSettings: true }
  }

  const jump: JumpInput = {
    workspace,
    teams: input.teams,
    views: input.views,
    canManage: input.canManage,
    routeTeam: context.team?.slug,
  }
  const switchInput: SwitchInput = {
    workspace,
    teams: input.teams,
    workspaces: input.workspaces,
    canManage: input.canManage,
    canCreateWorkspace: input.canCreateWorkspace,
  }
  const heading = context.heading ?? 'This page'
  const pageActions = typed.contextCleared
    ? []
    : contextActions(input.pathname, context, input.changed, q === '' ? heading : GROUPS.actions)

  // ---- Empty text ----
  if (q === '') {
    const groups: Entry.GroupView[] = []
    const add = (id: string, label: string, entries: Entry[]) => {
      if (entries.length > 0) groups.push({ id, label, entries })
    }
    if (kind !== undefined && kind !== 'commands') {
      const only = CHIP_RECENT[kind]
      add(
        GROUPS.recent,
        GROUPS.recent,
        only
          ? recentEntries(input.recents, input.teams, input.now, input.pathname, RECENT_SHOWN, only)
          : [],
      )
      return { ...base, groups, state: 'results', inSettings: false }
    }
    if (kind === undefined) add('page', heading, pageActions.slice(0, PAGE_ACTIONS_MAX))
    if (kind === undefined) {
      add(GROUPS.recent, GROUPS.recent, [
        ...recentEntries(input.recents, input.teams, input.now, input.pathname),
        ...searchEntries(input.searches ?? []),
      ])
      add(GROUPS.needs, GROUPS.needs, needsEntries(input.needs, jump))
    }
    add(GROUPS.goTo, GROUPS.goTo, goToEntries(jump))
    add(GROUPS.switch, GROUPS.switch, switchEntries(switchInput))
    return { ...base, groups, state: 'results', inSettings: false }
  }

  // ---- Typed text ----
  const number = parseBuildQuery(q)
  const local: Entry[] = []
  const commandsOnly = kind === 'commands'
  const wantsLocal = kind === undefined || commandsOnly
  if (wantsLocal) {
    local.push(...pageActions, ...goToEntries(jump), ...switchEntries(switchInput))
    if (workspace) {
      for (const t of (input.teams ?? []).filter((x) => !x.pinned)) {
        local.push(teamEntry(workspace, t, 'Teams'))
      }
    }
  }
  const scored = local
    .map((e) => Object.assign({}, e, { score: matchScore(e, words) }))
    .filter((e) => e.score > 0)

  const settingEntries: Entry[] = []
  if (wantsLocal) {
    const sections = settingsSections({ ...settingsInput, team: context.team?.slug })
    for (const s of sections) {
      if (matchesSettings(q, s)) {
        settingEntries.push(
          Object.assign(sectionEntry(s, { inside: false, current: false }), { score: 30 }),
        )
      }
    }
  }

  const searched: Entry[] = []
  if (!commandsOnly && workspace) {
    const rc: ResultsContext = {
      workspace,
      teams: input.teams,
      allTeams: scope === undefined,
      now: input.now,
    }
    searched.push(...resultEntries(rc, typed.results))
    const want = kind === undefined || kind === 'builds'
    if (
      number !== undefined &&
      want &&
      context.team &&
      scope?.slug === context.team.slug &&
      !searched.some((e) => e.id === `build:${context.team?.slug}:${number}`)
    ) {
      searched.unshift(jumpBuildEntry(workspace, context.team, number))
    }
  }
  const results = searched.map((e) =>
    Object.assign({}, e, { score: resultScore(e, words, number) }),
  )

  // Server results keep their ranking inside a group; the same row from two places shows once.
  const all = uniqueBy([...scored, ...settingEntries, ...results])

  // Best match: one row, only when it is clearly the one.
  let best: Entry | undefined
  const real = all.filter(isReal)
  const top = real.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  const exactBuild =
    number !== undefined ? real.find((e) => e.kind === 'build' && e.score === 100) : undefined
  if (exactBuild) best = exactBuild
  else if (top && (top.score ?? 0) >= 80) {
    const second = real.find((e) => e !== top && (e.score ?? 0) > (top.score ?? 0) - 20)
    if (!second) best = top
  }

  const groupMap = new Map<string, Entry[]>()
  for (const e of all) {
    if (e === best || (best && e.id === best.id)) continue
    const list = groupMap.get(e.group) ?? []
    list.push(e)
    groupMap.set(e.group, list)
  }
  const ordered = [...groupMap.entries()].toSorted(
    ([a, ea], [b, eb]) =>
      tier(eb) - tier(ea) ||
      (TIE_ORDER.indexOf(a) === -1 ? 99 : TIE_ORDER.indexOf(a)) -
        (TIE_ORDER.indexOf(b) === -1 ? 99 : TIE_ORDER.indexOf(b)),
  )

  const groups: Entry.GroupView[] = []
  if (best) groups.push({ id: 'best', label: '', entries: [best] })
  const totals = typed.results?.totals
  for (const [label, entries] of ordered) {
    const resultKind = (GROUP_KIND as Record<string, Search.Kind | undefined>)[label]
    if (resultKind === undefined || kind !== undefined) {
      groups.push({ id: label, label, entries })
      continue
    }
    const shown = entries.slice(0, GROUP_CAP)
    const total = Math.max(totals?.[resultKind] ?? 0, entries.length)
    const rows = [...shown]
    if (total > shown.length) {
      const chip = CHIP_OF_KIND[resultKind]
      const [one, many] = KIND_NOUN[resultKind]
      rows.push(moreEntry(label, chip, `Show all ${count(total, one, many)}`))
    }
    groups.push({ id: label, label, entries: rows })
  }

  // The widen row ends the list when the search is limited to a team.
  const tail: Entry[] = []
  if (scope && !commandsOnly && workspace) {
    tail.push({
      id: 'widen',
      group: 'widen',
      kind: 'widen',
      label: `Search all teams for "${q}"`,
      hint: 'mod+Enter',
      icon: 'search',
      target: { type: 'widen' },
      peek: {
        kind: 'Action',
        title: 'Search all teams',
        lines: [`Looks for "${q}" in every team you can see, not only ${scope.name}.`],
        rows: [],
      },
    })
  }

  const hasRows = groups.some((g) => g.entries.some(isReal))
  const base2 = { ...base, inSettings: false as const }
  if (typed.failed && !commandsOnly) {
    const retry: Entry = {
      id: 'retry',
      group: 'retry',
      kind: 'retry',
      label: 'Try again',
      icon: 'retry',
      target: { type: 'retry' },
      peek: { kind: 'Action', title: 'Try again', lines: ['Searches again.'], rows: [] },
    }
    return {
      ...base2,
      groups: [...groups, { id: 'retry', label: '', entries: [retry] }],
      state: 'error',
      message: "Couldn't search. Check your connection and try again.",
    }
  }
  if (!hasRows && !typed.pending) {
    const rows: Entry[] = [...tail]
    if (kind === undefined && !commandsOnly) {
      rows.push(moreEntry('none', 'builds', 'Show all builds'))
    }
    rows.push({
      id: 'pages',
      group: 'none',
      kind: 'more',
      label: 'Show all pages',
      icon: 'filter',
      target: { type: 'clear' },
      peek: { kind: 'Action', title: 'Show all pages', lines: ['Clears the field.'], rows: [] },
    })
    return {
      ...base2,
      groups: [{ id: 'none', label: '', entries: rows.slice(0, 3) }],
      state: 'none',
      message: scope ? `No results for "${q}" in ${scope.name}.` : `No results for "${q}".`,
      ...(/\d/.test(q) ? {} : { tip: 'Try a build number like #148.' }),
    }
  }
  if (tail.length > 0) groups.push({ id: 'widen', label: '', entries: tail })
  return {
    ...base2,
    groups,
    state: typed.pending && !commandsOnly ? 'searching' : 'results',
  }
}

const CHIP_OF_KIND: Record<Search.Kind, ChipKind> = {
  builds: 'builds',
  branches: 'branches',
  snapshots: 'screenshots',
  baselines: 'baselines',
  triage: 'triage',
  notifications: 'notices',
  reviews: 'reviews',
  views: 'views',
  teams: 'teams',
  people: 'people',
}

function moreEntry(group: string, chip: ChipKind, label: string): Entry {
  return {
    id: `more:${group}:${chip}`,
    group,
    kind: 'more',
    label,
    icon: 'filter',
    target: { type: 'chip', chip: { type: 'kind', kind: chip } },
    peek: {
      kind: 'Action',
      title: label,
      lines: [`Searches only ${KIND_CHIPS[chip].label.toLowerCase()} for the same text.`],
      rows: [],
    },
  }
}

/** Inside settings: the frame's sections and the way back, filtered by what is typed. */
function settingsList(
  input: ListInput,
  settingsInput: SettingsInput,
  words: readonly string[],
): Pick<ListView, 'groups' | 'state'> {
  const parts = input.pathname.split('/').filter(Boolean)
  const routeTeam =
    parts[0] !== 'workspaces' && parts[0] !== 'account' && parts[0] !== 'instance'
      ? parts[1]
      : undefined
  const sections = settingsSections({
    ...settingsInput,
    team: routeTeam ? decodeURIComponent(routeTeam) : undefined,
  })
  const here = (path: string) => input.pathname === path.split('?')[0]
  const rows = sections.map((s) => sectionEntry(s, { inside: true, current: here(s.path) }))
  const filtered =
    words.length === 0
      ? rows
      : rows.filter((e) => matchScore({ label: e.label, keywords: e.keywords ?? [] }, words) > 0)
  const back = input.leave ?? { path: LEAVE_PATH, label: 'Inbox' }
  const leave: Entry = {
    id: 'settings:leave',
    group: LEAVE_SETTINGS,
    kind: 'action',
    label: `Back to ${back.label}`,
    icon: 'back',
    target: { type: 'path', path: back.path },
    keywords: ['leave', 'exit', 'close', 'settings', 'back'],
    peek: {
      kind: 'Action',
      title: `Back to ${back.label}`,
      lines: [`Leaves settings and goes back to ${back.label}.`],
      rows: [],
    },
  }
  const leaveRows = words.length === 0 || matchScore(leave, words) > 0 ? [leave] : []
  const groups: Entry.GroupView[] = []
  if (filtered.length > 0) groups.push({ id: IN_SETTINGS, label: IN_SETTINGS, entries: filtered })
  if (leaveRows.length > 0)
    groups.push({ id: LEAVE_SETTINGS, label: LEAVE_SETTINGS, entries: leaveRows })
  return { groups, state: 'results' }
}

/** The tips the peek pane rotates through when nothing is highlighted. */
export const TIPS: readonly string[] = [
  'Type # and a number to jump to a build.',
  'Type > to run a command.',
  'Press ⌘. for the actions of the highlighted row.',
  'Type in:web to search one team.',
  'Type / to search screenshots.',
]

const GO_NOUN: Partial<Record<Entry['kind'], string>> = {
  build: 'build',
  team: 'team',
  page: 'page',
  branch: 'branch',
  screenshot: 'screenshot',
  baseline: 'baseline',
  triage: 'triage item',
  notice: 'notice',
  review: 'review request',
  view: 'saved view',
  setting: 'settings',
}

/** The peek pane's button: `Go to build`, `Run`, `Choose`. */
export function peekButton(entry: Entry): string {
  const verb = verbOf(entry)
  if (verb !== 'Go to') return verb
  const noun = GO_NOUN[entry.kind]
  return noun ? `Go to ${noun}` : 'Go to'
}

// The footer -------------------------------------------------------------------------------

/** One hint of the footer: the keys and what they do. */
export interface Hint {
  keys: string[]
  label: string
  /** Shown on narrow screens too (only Esc is). */
  narrow?: boolean
}

/** The keys that work for the highlighted row, and only those. */
export function footerHints(input: {
  nested: boolean
  entry: Entry | undefined
  /** ⌘. has actions to list for the row. */
  rowActions: boolean
  /** Backspace in the empty field removes a chip or the page scope. */
  removable: boolean
}): Hint[] {
  const { entry } = input
  if (input.nested) {
    return [
      { keys: ['←'], label: 'Back' },
      { keys: ['↵'], label: 'Choose' },
      { keys: ['Esc'], label: 'Back', narrow: true },
    ]
  }
  const hints: Hint[] = [{ keys: ['↑', '↓'], label: 'move' }]
  hints.push({ keys: ['↵'], label: verbOf(entry) })
  if (entry?.kind === 'widen') hints.push({ keys: ['⌘↵'], label: 'Search all teams' })
  else if (entry?.path) hints.push({ keys: ['⌘↵'], label: 'New tab' })
  if (input.rowActions) hints.push({ keys: ['⌘.'], label: 'Actions' })
  if (input.removable) hints.push({ keys: ['⌫'], label: 'Remove scope' })
  hints.push({ keys: ['Esc'], label: 'close', narrow: true })
  return hints
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
