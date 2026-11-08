import type { Project } from '@circi/api'

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

/** The organization's projects for the sidebar: alphabetical, at most `limit` (plus the open one, `keep`), and how many exist. */
export function sidebarProjects(
  projects: readonly Project.Overview[] | undefined,
  orgSlug: string | undefined,
  limit = SIDEBAR_PROJECT_LIMIT,
  keep?: string,
): { shown: { slug: string; name: string }[]; total: number } {
  const all = (projects ?? [])
    .filter((p) => p.org.slug === orgSlug)
    .map((p) => ({ slug: p.project.slug, name: p.project.name }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const shown = all.slice(0, limit)
  // The open project stays listed even past the cap, so its pages are always reachable.
  const open = all.find((p) => p.slug === keep)
  if (open && !shown.includes(open)) shown.push(open)
  return { shown, total: all.length }
}

export type Section = 'projects' | 'members' | 'account' | 'builds' | 'sites' | 'settings'

const SECTION_LABEL: Record<Section, string> = {
  projects: 'Projects',
  members: 'Members',
  account: 'Account',
  builds: 'Builds',
  sites: 'Sites',
  settings: 'Settings',
}

export const sectionLabel = (section: Section | undefined): string | undefined =>
  section ? SECTION_LABEL[section] : undefined

/** Which page of the app an address is, as far as the sidebar marks it. */
export function currentSection(pathname: string): Section | undefined {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return 'projects'
  if (parts[0] === 'account') return 'account'
  if (parts[0] === 'organizations') return parts[2] === 'members' ? 'members' : undefined
  if (parts[0] === '_sso') return undefined
  if (parts.length === 2) return 'builds'
  if (parts[2] === 'builds') return 'builds'
  if (parts[2] === 'sites') return 'sites'
  if (parts[2] === 'settings') return 'settings'
  return undefined
}

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
