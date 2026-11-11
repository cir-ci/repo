import type { NavigateOptions } from '@tanstack/react-router'

/**
 * THE breadcrumb rule, for every page in the app (BuildStates board, card 6):
 *
 * - A crumb always shows a display name ("Acme", "Web app"), never a slug.
 * - The workspace crumb links to that workspace's Inbox ("Workspace: opens the Inbox"); the project crumb links
 *   to that project's Builds page ("Project: opens its Builds page"), never to settings. Settings pages use
 *   `settingsCrumbsFor`: there the workspace is plain text, since nothing links out of settings.
 * - A workspace-level page starts with the workspace crumb; a project-level page with the workspace
 *   crumb, then the project crumb. The page's own crumbs ("Settings", "Integrations") follow, then
 *   `PageHeading`'s `title` as the current page.
 *
 *   crumbsFor({ workspace: { slug, name }, project: { slug, name } }, [settingsCrumb(slug, project)])
 */
export interface Crumb {
  label: string
  /** Where the crumb goes; without one it is plain text. */
  link?: NavigateOptions
  /** Names the link's target on hover and focus ("Project: opens its Builds page"). */
  tooltip?: string
}

type Named = { slug: string; name: string }

/** The workspace's crumb: its display name, linking to its Inbox. */
export function workspaceCrumb(workspace: Named): Crumb {
  return { label: workspace.name, link: { to: '/inbox' }, tooltip: 'Workspace: opens the Inbox' }
}

/** A project's crumb: its display name, linking to its Builds page. */
export function projectCrumb(workspace: string, project: Named): Crumb {
  return {
    label: project.name,
    link: { to: '/$workspace/$project', params: { workspace, project: project.slug } },
    tooltip: 'Project: opens its Builds page',
  }
}

/** The leading crumbs of a page: the workspace, then the project on a project-level page, then `trail`. */
export function crumbsFor(
  where: { workspace: Named; project?: Named },
  trail: ReadonlyArray<Crumb> = [],
): Crumb[] {
  return [
    workspaceCrumb(where.workspace),
    ...(where.project ? [projectCrumb(where.workspace.slug, where.project)] : []),
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

/** The workspace's Projects settings, the parent of a project's own settings. */
export function projectsSettingsCrumb(workspace: string): Crumb {
  return {
    label: 'Projects',
    link: { to: '/workspaces/$workspace/settings/projects', params: { workspace } },
  }
}

/** A project's settings hub, the parent of each of its settings pages. */
export function projectsettingsCrumb(workspace: string, project: string, name: string): Crumb {
  return {
    label: name,
    link: { to: '/$workspace/$project/settings', params: { workspace, project } },
  }
}

/** The "Builds" crumb of a build page (Workspace / Project / Builds / Build #N): the project's Builds page. */
export function projectBuildsCrumb(workspace: string, project: string): Crumb {
  return {
    label: 'Builds',
    link: { to: '/$workspace/$project', params: { workspace, project } },
  }
}

/** A workspace's "Settings" crumb, for pages below the settings home. */
export function workspaceSettingsCrumb(workspace: string): Crumb {
  return {
    label: 'Settings',
    link: { to: '/workspaces/$workspace/settings', params: { workspace } },
  }
}
