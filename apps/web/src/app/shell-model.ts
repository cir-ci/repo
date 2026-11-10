import type { Team, Sidebar, View } from '@circi/api'

import type { Shortcut } from '#lib/shortcuts.ts'

/** What the sidebar needs to know, kept apart from rendering so it can be tested without a DOM. */

export interface WorkspaceRef {
  slug: string
  name: string
  /** Where the workspace's picture is served from; absent or null: the first letter shows. */
  picture?: string | null
}

/** How many of the workspace's teams the sidebar lists before "All teams". */
export const SIDEBAR_TEAM_LIMIT = 10

/**
 * The workspaces a person can switch between: those of the teams they can see, the ones
 * they can manage (they may have no team yet) and the one in the address. Sorted by name.
 */
export function listWorkspaces(
  teams: readonly Team.Overview[] | undefined,
  manageable: readonly WorkspaceRef[] | undefined,
  routeWorkspace?: string,
): WorkspaceRef[] {
  const bySlug = new Map<string, WorkspaceRef>()
  for (const p of teams ?? [])
    bySlug.set(p.workspace.slug, {
      slug: p.workspace.slug,
      name: p.workspace.name,
      picture: p.workspace.picture,
    })
  for (const o of manageable ?? []) {
    bySlug.set(o.slug, {
      slug: o.slug,
      name: o.name,
      picture: o.picture ?? bySlug.get(o.slug)?.picture,
    })
  }
  if (routeWorkspace && !bySlug.has(routeWorkspace))
    bySlug.set(routeWorkspace, { slug: routeWorkspace, name: routeWorkspace })
  return [...bySlug.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}

/** The workspace the sidebar is about: the one in the address, else the last chosen, else the first. */
export function pickWorkspace(
  workspaces: readonly WorkspaceRef[],
  routeWorkspace: string | undefined,
  remembered: string | undefined,
): WorkspaceRef | undefined {
  return (
    workspaces.find((o) => o.slug === routeWorkspace) ??
    workspaces.find((o) => o.slug === remembered) ??
    workspaces[0]
  )
}

/**
 * The sidebar's teams in display order: pinned ones first (in the order the server gives, the
 * pin order), then the rest A to Z.
 */
export function orderTeams(teams: readonly Sidebar.Team[]): Sidebar.Team[] {
  const rest = teams.filter((p) => !p.pinned).toSorted((a, b) => a.name.localeCompare(b.name))
  return [...teams.filter((p) => p.pinned), ...rest]
}

/** The teams the sidebar lists: in order, at most `limit`, plus the open one (`keep`); and how many exist. */
export function sidebarTeams(
  teams: readonly Sidebar.Team[] | undefined,
  limit = SIDEBAR_TEAM_LIMIT,
  keep?: string,
): { shown: Sidebar.Team[]; total: number } {
  const all = orderTeams(teams ?? [])
  const shown = all.slice(0, limit)
  // The open team stays listed even past the cap, so its pages are always reachable.
  const open = all.find((p) => p.slug === keep)
  if (open && !shown.includes(open)) shown.push(open)
  return { shown, total: all.length }
}

/** A count is shown only when there is something waiting. */
export const countOrUndefined = (n: number | undefined): number | undefined => (n ? n : undefined)

/** The saved views under "Your views": the pinned ones, in the user's order. */
export function pinnedViews(views: readonly View.Item[] | undefined): View.Item[] {
  return (views ?? []).filter((v) => v.pinned).toSorted((a, b) => a.position - b.position)
}

/** The page a go-to chord (`G I`, `G R`, …) opens, or nothing when it has no workspace or team to open in. */
export function goPath(
  target: Shortcut.GoTarget,
  where: {
    workspace?: string | undefined
    team?: string | undefined
    teams?: readonly Sidebar.Team[]
  },
): string | undefined {
  const workspace = where.workspace ? encodeURIComponent(where.workspace) : undefined
  if (target === 'inbox') return '/inbox'
  if (target === 'teams') return '/'
  if (target === 'settings')
    return workspace ? `/workspaces/${workspace}/settings` : '/account/profile'
  if (!workspace) return undefined
  if (target === 'reviews') return `/workspaces/${workspace}/reviews`
  // Triage: the open team's queue; elsewhere the first team with something waiting, else the first.
  const ordered = orderTeams(where.teams ?? [])
  const slug = where.team ?? (ordered.find((p) => p.triage > 0) ?? ordered[0])?.slug
  return slug ? `/${workspace}/${encodeURIComponent(slug)}/triage` : undefined
}

export type Section =
  | 'teams'
  | 'inbox'
  | 'reviews'
  | 'insights'
  | 'views'
  | 'account'
  | 'settings'
  | 'instance'
  | 'builds'
  | 'sites'
  | 'triage'
  | 'baselines'
  | 'team-settings'

const SECTION_LABEL: Record<Section, string> = {
  teams: 'Teams',
  inbox: 'Inbox',
  reviews: 'Reviews',
  insights: 'Insights',
  views: 'Views',
  account: 'Account',
  settings: 'Settings',
  instance: 'Instance',
  builds: 'Builds',
  sites: 'Sites',
  triage: 'Triage',
  baselines: 'Baselines',
  'team-settings': 'Settings',
}

export const sectionLabel = (section: Section | undefined): string | undefined =>
  section ? SECTION_LABEL[section] : undefined

const WORKSPACE_SECTIONS: Partial<Record<string, Section>> = {
  reviews: 'reviews',
  insights: 'insights',
  views: 'views',
  settings: 'settings',
}

const TEAM_SECTIONS: Partial<Record<string, Section>> = {
  builds: 'builds',
  sites: 'sites',
  triage: 'triage',
  baselines: 'baselines',
  settings: 'team-settings',
}

/** Which page of the app an address is, as far as the sidebar marks it. */
export function currentSection(pathname: string): Section | undefined {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return 'teams'
  if (parts[0] === 'account') return 'account'
  if (parts[0] === 'instance') return 'instance'
  if (parts[0] === 'inbox') return 'inbox'
  if (parts[0] === 'workspaces') return WORKSPACE_SECTIONS[parts[2] ?? '']
  if (parts[0] === '_sso') return undefined
  if (parts.length === 2) return 'builds'
  return TEAM_SECTIONS[parts[2] ?? '']
}

/** Settings pages (account, workspace, team, instance) share one layout with the settings nav. */
export const isSettingsSection = (section: Section | undefined): boolean =>
  section === 'account' ||
  section === 'settings' ||
  section === 'team-settings' ||
  section === 'instance'

/** Pages shown without the sidebar: they belong to a flow (a hosted site's sign-in), not the dashboard. */
export const isOutsideFrame = (pathname: string): boolean => pathname.startsWith('/_sso/')

const REMEMBERED_WORKSPACE_KEY = 'circi-workspace'

/** The workspace chosen last time, if the browser lets us read it. */
export function readRememberedWorkspace(): string | undefined {
  try {
    return localStorage.getItem(REMEMBERED_WORKSPACE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function rememberWorkspace(slug: string): void {
  try {
    localStorage.setItem(REMEMBERED_WORKSPACE_KEY, slug)
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

// ---- Account, instance and the settings tree ----------------------------------------------------

/**
 * Where the workspace switcher goes from `pathname` when `toWorkspace` is picked: the equivalent
 * page of the new workspace. Workspace pages (`/workspaces/<ws>/...`) keep their page under the new
 * slug (a page that belongs to one item, a view or an integration, goes up to its list); team
 * pages keep their section on `teamOf(toWorkspace)` (its remembered or first team), dropping the
 * build number, snapshot and the like, or go to the Teams page when the workspace has no team.
 * The Teams page stays itself (`/`). Global pages (Inbox, account, instance, ...) have no
 * equivalent: `undefined`, the address stays.
 */
export function switchWorkspacePath(
  pathname: string,
  toWorkspace: string,
  teamOf: (workspace: string) => string | undefined,
): string | undefined {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return '/'
  const first = parts[0] ?? ''
  const to = encodeURIComponent(toWorkspace)
  if (first === 'workspaces') {
    const [, , section, sub] = parts
    if (section === 'settings') return `/workspaces/${to}/settings${sub ? `/${sub}` : ''}`
    // A saved view belongs to the workspace it was saved in: land on the new one's Teams page.
    if (section === 'views' || !section) return '/'
    return `/workspaces/${to}/${section}`
  }
  if (GLOBAL_ROOTS.has(first)) return undefined
  const team = teamOf(toWorkspace)
  if (!team) return '/'
  const base = `/${to}/${encodeURIComponent(team)}`
  const section = parts[2]
  if (section === 'triage' || section === 'baselines' || section === 'sites')
    return `${base}/${section}`
  if (section === 'settings') return `${base}/settings${parts[3] ? `/${parts[3]}` : ''}`
  return base
}

const GLOBAL_ROOTS = new Set(['inbox', 'account', 'instance', 'integrations', '_sso'])

/** The first letter of a workspace's name, lower case as on the canvas. */
export const workspaceLetter = (name: string): string => name.trim()[0]?.toLowerCase() ?? '?'

/** The settings pages of a team, in the order of the settings nav: `path` is what follows `/settings`. */
export const TEAM_SETTINGS_PAGES = [
  { key: 'general', label: 'General', path: '' },
  { key: 'token', label: 'CI token', path: '/token' },
  { key: 'reviews', label: 'Reviews and triage', path: '/reviews' },
  { key: 'webhooks', label: 'Webhooks', path: '/webhooks' },
  { key: 'ignore-regions', label: 'Ignore regions', path: '/ignore-regions' },
] as const

export type TeamSettingsKey = (typeof TEAM_SETTINGS_PAGES)[number]['key']

/** Which team settings page an address is (General for the bare `/settings`), if it is one. */
export function teamSettingsKey(pathname: string): TeamSettingsKey | undefined {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'workspaces' || parts[0] === 'account' || parts[0] === 'instance')
    return undefined
  if (parts[2] !== 'settings') return undefined
  return TEAM_SETTINGS_PAGES.find((p) => p.path === (parts[3] ? `/${parts[3]}` : ''))?.key
}

/**
 * The same settings page of another team: switching teams in the settings nav stays on the page
 * you are on (CI token stays CI token), and lands on General when the current address is not
 * a team settings page.
 */
export function teamSettingsPath(workspace: string, team: string, pathname: string): string {
  const key = teamSettingsKey(pathname)
  const page = TEAM_SETTINGS_PAGES.find((p) => p.key === key)
  return `/${encodeURIComponent(workspace)}/${encodeURIComponent(team)}/settings${page?.path ?? ''}`
}

/** The teams whose name contains what was typed in the team switcher. */
export function matchTeams<T extends { name: string }>(teams: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  return needle ? teams.filter((t) => t.name.toLowerCase().includes(needle)) : [...teams]
}

/**
 * The team the Team part of the settings nav is about: the one in the address, else the one
 * last used in settings (if it is still there), else the first. Nothing when there are no teams.
 */
export function pickSettingsTeam<T extends { slug: string }>(
  teams: readonly T[],
  routeTeam: string | undefined,
  remembered: string | undefined,
): T | undefined {
  return (
    teams.find((t) => t.slug === routeTeam) ?? teams.find((t) => t.slug === remembered) ?? teams[0]
  )
}

/**
 * The teams the settings nav may offer for a workspace: the sidebar's teams, kept to those the
 * teams list (refreshed on a rename) also knows in that workspace. A slug that was renamed, or a
 * team of another workspace in a stale cache, is never offered. When the teams list knows nothing
 * of the workspace (a manager with no team of their own) the sidebar's teams stand as they are.
 */
export function settingsTeams<T extends { slug: string }>(
  inSidebar: readonly T[],
  overview: readonly Team.Overview[] | undefined,
  workspace: string,
): T[] {
  const known = (overview ?? []).filter((o) => o.workspace.slug === workspace)
  if (known.length === 0) return [...inSidebar]
  const slugs = new Set(known.map((o) => o.team.slug))
  return inSidebar.filter((t) => slugs.has(t.slug))
}

/**
 * `settingsTeams`, plus the team whose settings are open (`routeTeam`) whenever either list knows
 * it. After a slug rename the sidebar and the teams list refresh one after the other, so for a
 * moment only one of them has the new slug; the label of the open team must not turn into another
 * team meanwhile.
 */
export function settingsNavTeams(
  inSidebar: readonly Sidebar.Team[],
  overview: readonly Team.Overview[] | undefined,
  workspace: string,
  routeTeam: string | undefined,
): Sidebar.Team[] {
  const teams = settingsTeams(inSidebar, overview, workspace)
  if (routeTeam === undefined || teams.some((t) => t.slug === routeTeam)) return teams
  const fromSidebar = inSidebar.find((t) => t.slug === routeTeam)
  const known = (overview ?? []).find(
    (o) => o.workspace.slug === workspace && o.team.slug === routeTeam,
  )?.team
  const open: Sidebar.Team | undefined =
    fromSidebar ??
    (known
      ? {
          slug: known.slug,
          name: known.name,
          color: known.color,
          icon: known.icon,
          pinned: false,
          triage: 0,
        }
      : undefined)
  return open ? [...teams, open] : teams
}

const REMEMBERED_TEAM_KEY = 'circi-settings-team'

export function readRememberedTeam(workspace: string): string | undefined {
  try {
    return localStorage.getItem(`${REMEMBERED_TEAM_KEY}:${workspace}`) ?? undefined
  } catch {
    return undefined
  }
}

export function rememberTeam(workspace: string, team: string): void {
  try {
    localStorage.setItem(`${REMEMBERED_TEAM_KEY}:${workspace}`, team)
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

/** A team's slug changed: what was remembered under the old one now points at the new one. */
export function renameRememberedTeam(workspace: string, from: string, to: string): void {
  if (readRememberedTeam(workspace) === from) rememberTeam(workspace, to)
}
