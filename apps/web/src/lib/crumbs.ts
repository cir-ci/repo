import type { NavigateOptions } from '@tanstack/react-router'

/**
 * THE breadcrumb rule, for every page in the app (BuildStates board, card 6):
 *
 * - A crumb always shows a display name ("Acme", "Web app"), never a slug.
 * - The workspace crumb links to that workspace's Inbox ("Workspace: opens the Inbox"); the team crumb links
 *   to that team's Builds page ("Team: opens its Builds page"), never to settings. Settings pages use
 *   `settingsCrumbsFor`: there the workspace is plain text, since nothing links out of settings.
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
  /** Names the link's target on hover and focus ("Team: opens its Builds page"). */
  tooltip?: string
}

type Named = { slug: string; name: string }

/** The workspace's crumb: its display name, linking to its Inbox. */
export function workspaceCrumb(workspace: Named): Crumb {
  return { label: workspace.name, link: { to: '/inbox' }, tooltip: 'Workspace: opens the Inbox' }
}

/** A team's crumb: its display name, linking to its Builds page. */
export function teamCrumb(workspace: string, team: Named): Crumb {
  return {
    label: team.name,
    link: { to: '/$workspace/$team', params: { workspace, team: team.slug } },
    tooltip: 'Team: opens its Builds page',
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

/**
 * The leading crumbs of a settings page. Settings is a closed area (CLAUDE.md): the workspace's
 * name is plain text there, not a link out to its Inbox; settings' way back is the settings nav.
 */
export function settingsCrumbsFor(workspace: Named, trail: ReadonlyArray<Crumb> = []): Crumb[] {
  return [{ label: workspace.name }, ...trail]
}

/** The Instance crumb of an instance page: the Instance hub. */
export function instanceCrumb(): Crumb {
  return { label: 'Instance', link: { to: '/instance/overview' } }
}

/** The instance's Workspaces list, the parent of a workspace's settings hub (instance admins). */
export function workspacesCrumb(): Crumb {
  return { label: 'Workspaces', link: { to: '/instance/workspaces' } }
}

/** The workspace's Teams settings, the parent of a team's own settings. */
export function teamsSettingsCrumb(workspace: string): Crumb {
  return {
    label: 'Teams',
    link: { to: '/workspaces/$workspace/settings/teams', params: { workspace } },
  }
}

/** A team's settings hub, the parent of each of its settings pages. */
export function teamSettingsCrumb(workspace: string, team: string, name: string): Crumb {
  return {
    label: name,
    link: { to: '/$workspace/$team/settings', params: { workspace, team } },
  }
}

/** The "Builds" crumb of a build page (Workspace / Team / Builds / Build #N): the team's Builds page. */
export function teamBuildsCrumb(workspace: string, team: string): Crumb {
  return {
    label: 'Builds',
    link: { to: '/$workspace/$team', params: { workspace, team } },
  }
}

/** A workspace's "Settings" crumb, for pages below the settings home. */
export function workspaceSettingsCrumb(workspace: string): Crumb {
  return {
    label: 'Settings',
    link: { to: '/workspaces/$workspace/settings', params: { workspace } },
  }
}
