import type { Sidebar, View } from '@circi/api'

import type { RecentEntry } from '#lib/stores/recent-store.ts'

/**
 * What counts as a visit for Recent: a build, a project, a baseline, a triage item (an address with
 * `?item=`) or a saved view. Every other page leaves nothing. Works from the address alone, so it
 * needs no data of the page.
 */

/** The first path segments that are not a workspace's slug. */
const NOT_A_WORKSPACE = new Set(['workspaces', 'account', 'instance', 'inbox', '_sso'])

const decode = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function classifyVisit(
  pathname: string,
  searchStr: string,
  projects: readonly Pick<Sidebar.Project, 'slug' | 'name'>[] | undefined,
  views: readonly Pick<View.Item, 'id' | 'name'>[] | undefined,
  now: number,
): { workspace: string; entry: RecentEntry } | undefined {
  const parts = pathname.split('/').filter(Boolean)
  const first = parts[0]
  if (first === undefined) return undefined
  if (first === 'workspaces') {
    if (parts[2] !== 'views' || parts[3] === undefined) return undefined
    const id = decode(parts[3])
    const view = views?.find((v) => v.id === id)
    if (!view) return undefined
    return {
      workspace: decode(parts[1] ?? ''),
      entry: { kind: 'view', id: `view:${id}`, label: view.name, path: pathname, at: now },
    }
  }
  if (NOT_A_WORKSPACE.has(first) || parts[1] === undefined) return undefined
  const workspace = decode(first)
  const slug = decode(parts[1])
  const projectName = projects?.find((t) => t.slug === slug)?.name ?? slug
  const section = parts[2]
  if (section === undefined) {
    return {
      workspace,
      entry: {
        kind: 'project',
        id: `project:${slug}`,
        label: projectName,
        path: pathname,
        at: now,
      },
    }
  }
  if (section === 'builds' && parts[3] !== undefined && parts.length === 4) {
    return {
      workspace,
      entry: {
        kind: 'build',
        id: `build:${slug}:${parts[3]}`,
        label: `Build #${parts[3]}`,
        detail: projectName,
        path: pathname,
        at: now,
      },
    }
  }
  if (section === 'baselines' && parts.length > 3) {
    const name = parts.slice(3).map(decode).join('/')
    return {
      workspace,
      entry: {
        kind: 'baseline',
        id: `baseline:${slug}:${name}`,
        label: name,
        detail: projectName,
        path: pathname,
        at: now,
      },
    }
  }
  if (section === 'triage' && parts.length === 3) {
    const item = new URLSearchParams(searchStr).get('item')
    if (!item) return undefined
    const [kind, ...rest] = item.split(':')
    const key = rest.join(':')
    const label =
      kind === 'failed' ? `Build #${key.replace(/^build:/, '')} failed` : key || 'Triage item'
    return {
      workspace,
      entry: {
        kind: 'triage',
        id: `triage:${slug}:${item}`,
        label,
        detail: projectName,
        path: `${pathname}?item=${encodeURIComponent(item)}`,
        at: now,
      },
    }
  }
  return undefined
}

/** "just now", "5 min ago", "2 h ago", "3 d ago": how long ago, for the Recent rows. */
export function shortAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}
