import type { NavigateOptions } from '@tanstack/react-router'

/**
 * THE breadcrumb rule, for every page in the app (BuildStates board, card 6):
 *
 * - A crumb always shows a display name ("Acme", "Web app"), never a slug.
 * - The workspace crumb links to that workspace's Inbox ("Go to Inbox"); the team crumb links to
 *   that team's Builds page ("Go to Builds"), never to settings.
 * - A workspace-level page starts with the workspace crumb; a team-level page with the workspace
 *   crumb, then the team crumb. The page's own crumbs ("Settings", "Integrations") follow, then
 *   `PageHeading`'s `title` as the current page.
 *
 *   crumbsFor({ workspace: { slug, name }, team: { slug, name } }, [settingsCrumb(slug, team)])
 */
export interface Crumb {
  label: string
  /** Where the crumb goes; without one it is plain text. */
  link?: NavigateOptions
  /** Names the link's target on hover and focus ("Go to Builds"). */
  tooltip?: string
}

type Named = { slug: string; name: string }

/** The workspace's crumb: its display name, linking to its Inbox. */
export function workspaceCrumb(workspace: Named): Crumb {
  return { label: workspace.name, link: { to: '/inbox' }, tooltip: 'Go to Inbox' }
}

/** A team's crumb: its display name, linking to its Builds page. */
export function teamCrumb(workspace: string, team: Named): Crumb {
  return {
    label: team.name,
    link: { to: '/$workspace/$team', params: { workspace, team: team.slug } },
    tooltip: 'Go to Builds',
  }
}

/** The leading crumbs of a page: the workspace, then the team on a team-level page, then `trail`. */
export function crumbsFor(
  where: { workspace: Named; team?: Named },
  trail: ReadonlyArray<Crumb> = [],
): Crumb[] {
  return [
    workspaceCrumb(where.workspace),
    ...(where.team ? [teamCrumb(where.workspace.slug, where.team)] : []),
    ...trail,
  ]
}

/** A team's "Settings" crumb, for pages below the settings home. */
export function teamSettingsCrumb(workspace: string, team: string): Crumb {
  return {
    label: 'Settings',
    link: { to: '/$workspace/$team/settings', params: { workspace, team } },
    tooltip: 'Go to Settings',
  }
}

/** A workspace's "Settings" crumb, for pages below the settings home. */
export function workspaceSettingsCrumb(workspace: string): Crumb {
  return {
    label: 'Settings',
    link: { to: '/workspaces/$workspace/settings', params: { workspace } },
    tooltip: 'Go to Settings',
  }
}
