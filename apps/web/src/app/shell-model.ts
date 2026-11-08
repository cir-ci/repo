import type { Project, Sidebar, View } from '@circi/api'

import type { GoTarget } from '../lib/shortcuts.ts'

/** What the sidebar needs to know, kept apart from rendering so it can be tested without a DOM. */

export interface OrgRef {
  slug: string
  name: string
}

/** How many of the organization's projects the sidebar lists before "All projects". */
export const SIDEBAR_PROJECT_LIMIT = 10

/**
 * The organizations a person can switch between: those of the projects they can see, the ones
 * they can manage (they may have no project yet) and the one in the address. Sorted by name.
 */
export function listOrgs(
  projects: readonly Project.Overview[] | undefined,
  manageable: readonly OrgRef[] | undefined,
  routeOrg?: string,
): OrgRef[] {
  const bySlug = new Map<string, OrgRef>()
  for (const p of projects ?? []) bySlug.set(p.org.slug, { slug: p.org.slug, name: p.org.name })
  for (const o of manageable ?? []) bySlug.set(o.slug, { slug: o.slug, name: o.name })
  if (routeOrg && !bySlug.has(routeOrg)) bySlug.set(routeOrg, { slug: routeOrg, name: routeOrg })
  return [...bySlug.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}

/** The organization the sidebar is about: the one in the address, else the last chosen, else the first. */
export function pickOrg(
  orgs: readonly OrgRef[],
  routeOrg: string | undefined,
  remembered: string | undefined,
): OrgRef | undefined {
  return orgs.find((o) => o.slug === routeOrg) ?? orgs.find((o) => o.slug === remembered) ?? orgs[0]
}

/**
 * The sidebar's projects in display order: pinned ones first (in the order the server gives, the
 * pin order), then the rest A to Z.
 */
export function orderProjects(projects: readonly Sidebar.Project[]): Sidebar.Project[] {
  const rest = projects.filter((p) => !p.pinned).toSorted((a, b) => a.name.localeCompare(b.name))
  return [...projects.filter((p) => p.pinned), ...rest]
}

/** The projects the sidebar lists: in order, at most `limit`, plus the open one (`keep`); and how many exist. */
export function sidebarProjects(
  projects: readonly Sidebar.Project[] | undefined,
  limit = SIDEBAR_PROJECT_LIMIT,
  keep?: string,
): { shown: Sidebar.Project[]; total: number } {
  const all = orderProjects(projects ?? [])
  const shown = all.slice(0, limit)
  // The open project stays listed even past the cap, so its pages are always reachable.
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

/** The page a go-to chord (`G I`, `G R`, …) opens, or nothing when it has no organization or project to open in. */
export function goPath(
  target: GoTarget,
  where: {
    org?: string | undefined
    project?: string | undefined
    projects?: readonly Sidebar.Project[]
  },
): string | undefined {
  const org = where.org ? encodeURIComponent(where.org) : undefined
  if (target === 'inbox') return '/inbox'
  if (target === 'projects') return '/'
  if (target === 'settings') return org ? `/organizations/${org}/settings` : '/account'
  if (!org) return undefined
  if (target === 'reviews') return `/organizations/${org}/reviews`
  // Triage: the open project's queue; elsewhere the first project with something waiting, else the first.
  const ordered = orderProjects(where.projects ?? [])
  const slug = where.project ?? (ordered.find((p) => p.triage > 0) ?? ordered[0])?.slug
  return slug ? `/${org}/${encodeURIComponent(slug)}/triage` : undefined
}

export type Section =
  | 'projects'
  | 'inbox'
  | 'reviews'
  | 'insights'
  | 'views'
  | 'account'
  | 'settings'
  | 'builds'
  | 'sites'
  | 'triage'
  | 'baselines'
  | 'project-settings'

const SECTION_LABEL: Record<Section, string> = {
  projects: 'Projects',
  inbox: 'Inbox',
  reviews: 'Reviews',
  insights: 'Insights',
  views: 'Views',
  account: 'Account',
  settings: 'Settings',
  builds: 'Builds',
  sites: 'Sites',
  triage: 'Triage',
  baselines: 'Baselines',
  'project-settings': 'Settings',
}

export const sectionLabel = (section: Section | undefined): string | undefined =>
  section ? SECTION_LABEL[section] : undefined

const ORG_SECTIONS: Partial<Record<string, Section>> = {
  reviews: 'reviews',
  insights: 'insights',
  views: 'views',
  settings: 'settings',
}

const PROJECT_SECTIONS: Partial<Record<string, Section>> = {
  builds: 'builds',
  sites: 'sites',
  triage: 'triage',
  baselines: 'baselines',
  settings: 'project-settings',
}

/** Which page of the app an address is, as far as the sidebar marks it. */
export function currentSection(pathname: string): Section | undefined {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return 'projects'
  if (parts[0] === 'account') return 'account'
  if (parts[0] === 'inbox') return 'inbox'
  if (parts[0] === 'organizations') return ORG_SECTIONS[parts[2] ?? '']
  if (parts[0] === '_sso') return undefined
  if (parts.length === 2) return 'builds'
  return PROJECT_SECTIONS[parts[2] ?? '']
}

/** Settings pages (account, organisation, project) share one layout with the settings nav. */
export const isSettingsSection = (section: Section | undefined): boolean =>
  section === 'account' || section === 'settings' || section === 'project-settings'

/** Pages shown without the sidebar: they belong to a flow (a hosted site's sign-in), not the dashboard. */
export const isOutsideFrame = (pathname: string): boolean => pathname.startsWith('/_sso/')

const REMEMBERED_ORG_KEY = 'circi-org'

/** The organization chosen last time, if the browser lets us read it. */
export function readRememberedOrg(): string | undefined {
  try {
    return localStorage.getItem(REMEMBERED_ORG_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function rememberOrg(slug: string): void {
  try {
    localStorage.setItem(REMEMBERED_ORG_KEY, slug)
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}
