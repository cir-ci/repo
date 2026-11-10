import type { Team, Sidebar, View, Workspace } from '@circi/api'
import { RESERVED_SLUGS } from '@circi/core'

import type { Shortcut } from '#lib/shortcuts.ts'

/** What the sidebar needs to know, kept apart from rendering so it can be tested without a DOM. */

export interface WorkspaceRef {
  slug: string
  name: string
  /** Where the workspace's picture is served from; absent or null: the generated pattern shows. */
  picture?: string | null
  /** The person's role in it, when known (the workspace menu shows it). */
  role?: Workspace.Role
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
      ...(p.workspace.role ? { role: p.workspace.role } : {}),
    })
  for (const o of manageable ?? []) {
    const role = o.role ?? bySlug.get(o.slug)?.role
    bySlug.set(o.slug, {
      slug: o.slug,
      name: o.name,
      picture: o.picture ?? bySlug.get(o.slug)?.picture,
      ...(role ? { role } : {}),
    })
  }
  // An address for a workspace the lists don't know yet still counts, unless it can't be one: a
  // reserved word (`/workspaces/acme/teams` is an unknown page, not a workspace "workspaces").
  if (routeWorkspace && !bySlug.has(routeWorkspace) && !RESERVED_SLUGS.includes(routeWorkspace))
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
 * The workspace to tell the server about: the one in the address, when it is one of the person's
 * own (`known` has only real memberships, not an address nobody listed) and not what the server
 * already remembers. Undefined: nothing to write.
 */
export function workspaceToRemember(
  routeWorkspace: string | undefined,
  known: readonly WorkspaceRef[],
  serverValue: string | null | undefined,
): string | undefined {
  if (!routeWorkspace || routeWorkspace === serverValue) return undefined
  return known.some((w) => w.slug === routeWorkspace) ? routeWorkspace : undefined
}

/**
 * Where a landing page goes: the server's remembered workspace (it follows the account across
 * devices), else this browser's, then the first. Whichever is gone from `workspaces` is skipped.
 */
export function pickLandingWorkspace(
  workspaces: readonly WorkspaceRef[],
  serverValue: string | null | undefined,
  browserValue: string | undefined,
): WorkspaceRef | undefined {
  return (
    workspaces.find((w) => w.slug === serverValue) ??
    workspaces.find((w) => w.slug === browserValue) ??
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

/**
 * The team the phone's Triage tab and More sheet's Baselines open: the open one, else the first
 * with something to triage, else the first (pinned ones first).
 */
export function phoneTeam(
  teams: readonly Sidebar.Team[] | undefined,
  open?: string,
): Sidebar.Team | undefined {
  const ordered = orderTeams(teams ?? [])
  return ordered.find((t) => t.slug === open) ?? ordered.find((t) => t.triage > 0) ?? ordered[0]
}

/** One of your teams, in whichever workspace, as the phone's Teams tab and sheet show it. */
export interface YourTeam {
  workspace: { slug: string; name: string }
  slug: string
  name: string
  color: Team.Overview['team']['color']
  icon: string | null
  pinned: boolean
  /** Triage items waiting; 0 until the workspace's sidebar model has loaded. */
  triage: number
}

/**
 * Your teams across workspaces, pinned first (in the order the server gives within a workspace),
 * then the rest A to Z. The overview says which teams you have; each workspace's sidebar model,
 * once loaded, adds whether it is pinned and its triage count.
 */
export function yourTeams(
  overview: readonly Team.Overview[] | undefined,
  sidebars: Readonly<Record<string, Sidebar.Model | undefined>>,
): YourTeam[] {
  const all = (overview ?? []).map((item): YourTeam => {
    const known = sidebars[item.workspace.slug]?.teams.find((t) => t.slug === item.team.slug)
    return {
      workspace: { slug: item.workspace.slug, name: item.workspace.name },
      slug: item.team.slug,
      name: item.team.name,
      color: item.team.color,
      icon: item.team.icon,
      pinned: known?.pinned ?? false,
      triage: known?.triage ?? 0,
    }
  })
  const rest = all.filter((t) => !t.pinned).toSorted((a, b) => a.name.localeCompare(b.name))
  return [...all.filter((t) => t.pinned), ...rest]
}

/** A run of rows in the Teams sheet; `label` is absent when there is nothing to tell apart. */
export interface TeamSection {
  key: string
  label?: string
  /** Rows say which workspace each team is in (the Pinned run mixes workspaces). */
  showWorkspace: boolean
  teams: YourTeam[]
}

/**
 * The Teams sheet's rows: with one workspace, one run (pinned first). With several, a Pinned run
 * first (each row says its workspace), then one run per workspace, A to Z, of its other teams.
 */
export function teamSections(teams: readonly YourTeam[]): TeamSection[] {
  const workspaces = new Set(teams.map((t) => t.workspace.slug))
  if (workspaces.size <= 1)
    return teams.length === 0 ? [] : [{ key: 'all', showWorkspace: false, teams: [...teams] }]
  const sections: TeamSection[] = []
  const pinned = teams.filter((t) => t.pinned)
  if (pinned.length > 0)
    sections.push({ key: 'pinned', label: 'Pinned', showWorkspace: true, teams: pinned })
  const byWorkspace = new Map<string, YourTeam[]>()
  for (const t of teams.filter((x) => !x.pinned))
    byWorkspace.set(t.workspace.slug, [...(byWorkspace.get(t.workspace.slug) ?? []), t])
  const ordered = [...byWorkspace.values()].toSorted((a, b) =>
    (a[0]?.workspace.name ?? '').localeCompare(b[0]?.workspace.name ?? ''),
  )
  for (const list of ordered)
    sections.push({
      key: list[0]?.workspace.slug ?? '',
      label: list[0]?.workspace.name ?? '',
      showWorkspace: false,
      teams: list,
    })
  return sections
}

/** The Teams tab's label: the team's name when you are in exactly one, else "Teams". */
export const teamsTabLabel = (teams: readonly YourTeam[]): string =>
  teams.length === 1 ? (teams[0]?.name ?? 'Teams') : 'Teams'

/** How many team tiles the Teams tab's icon stacks. */
export const TEAM_STACK_LIMIT = 3

/** A count is shown only when there is something waiting. */
export const countOrUndefined = (n: number | undefined): number | undefined => (n ? n : undefined)

/** The saved views under "Your views": the pinned ones, in the user's order. */
export function pinnedViews(views: readonly View.Item[] | undefined): View.Item[] {
  return (views ?? []).filter((v) => v.pinned).toSorted((a, b) => a.position - b.position)
}

/**
 * Where a workspace's settings open: General for people who may change them, Members (the one
 * settings page a member can see) for everyone else. `canManage` is undefined until the sidebar
 * model has loaded; General then redirects a member on its own.
 */
export function workspaceSettingsPath(workspace: string, canManage: boolean | undefined): string {
  const base = `/workspaces/${encodeURIComponent(workspace)}/settings`
  return canManage === false ? `${base}/members` : base
}

/** The page a go-to chord (`G I`, `G R`, …) opens, or nothing when it has no workspace or team to open in. */
export function goPath(
  target: Shortcut.GoTarget,
  where: {
    workspace?: string | undefined
    team?: string | undefined
    teams?: readonly Sidebar.Team[]
    canManage?: boolean | undefined
  },
): string | undefined {
  const workspace = where.workspace ? encodeURIComponent(where.workspace) : undefined
  if (target === 'inbox') return '/inbox'
  if (target === 'teams') return '/'
  if (target === 'settings')
    return where.workspace
      ? workspaceSettingsPath(where.workspace, where.canManage)
      : '/account/profile'
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

/** One of a team's four list pages. */
export type TeamPage = 'builds' | 'triage' | 'baselines' | 'sites'

/** The first address segments that are not a workspace's slug. */
const NOT_TEAMS = new Set(['workspaces', 'account', 'instance', 'inbox', 'integrations', '_sso'])

/**
 * Which of a team's four pages an address is, when it is exactly one (a build, a baseline or a
 * settings page is not): `/<workspace>/<team>` and its triage, baselines and sites lists.
 */
export function teamPageOf(pathname: string): TeamPage | undefined {
  const parts = pathname.split('/').filter(Boolean)
  const first = parts[0]
  if (parts.length < 2 || parts.length > 3) return undefined
  if (first && NOT_TEAMS.has(first)) return undefined
  if (parts.length === 2) return 'builds'
  const page = parts[2]
  return page === 'triage' || page === 'baselines' || page === 'sites' ? page : undefined
}

/** The team an address belongs to (`/<workspace>/<team>…`), if it is one of a team's pages. */
export function teamOfAddress(href: string): { workspace: string; team: string } | undefined {
  const parts = (href.split(/[?#]/)[0] ?? '').split('/').filter(Boolean)
  const [workspace, team] = parts
  if (!workspace || !team || NOT_TEAMS.has(workspace)) return undefined
  return { workspace: decodeURIComponent(workspace), team: decodeURIComponent(team) }
}

/** Settings pages (account, workspace, team, instance) share one layout with the settings nav. */
export const isSettingsSection = (section: Section | undefined): boolean =>
  section === 'account' ||
  section === 'settings' ||
  section === 'team-settings' ||
  section === 'instance'

/**
 * A build's page (`/<workspace>/<team>/builds/<number>`): on a phone it has its own bottom bar for
 * reviewing, so the tab bar steps aside.
 */
export function isBuildPage(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  return parts.length === 4 && parts[2] === 'builds'
}

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

/** The settings pages of a team, in the order of its tabs `path` is what follows `/settings`. */
export const TEAM_SETTINGS_PAGES = [
  { key: 'general', label: 'General', path: '' },
  { key: 'members', label: 'Members', path: '/members' },
  { key: 'token', label: 'CI token', path: '/token' },
  { key: 'reviews', label: 'Reviews and triage', path: '/reviews' },
  { key: 'webhooks', label: 'Webhooks', path: '/webhooks' },
  { key: 'ignore-regions', label: 'Ignore regions', path: '/ignore-regions' },
  { key: 'sites', label: 'Sites', path: '/sites' },
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
