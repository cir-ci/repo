import { onInstancePage } from '#features/instance/hub-model.ts'

/** The groups of the settings navigation, in their usual order (the hierarchy: Account, Instance, Workspace(s), Projects). */
export const SETTINGS_GROUPS = ['account', 'instance', 'workspace', 'projects'] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

/** Which group the page being viewed belongs to: its section opens and is listed first. */
export function currentSettingsGroup(pathname: string): SettingsGroup {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'account') return 'account'
  if (parts[0] === 'workspaces')
    return parts[2] === 'settings' && parts[3] === 'projects' ? 'projects' : 'workspace'
  // /instance/workspaces is the list of workspaces; every other Instance page is the Instance's.
  if (onInstancePage(pathname)) return 'instance'
  if (parts[0] === 'instance') return 'workspace'
  // /<workspace>/<project>/settings...: a project's.
  if (parts.length >= 3 && parts[2] === 'settings') return 'projects'
  return 'account'
}

/** The groups in display order: the current one first, then the others as usual. */
export function orderedSettingsGroups(
  current: SettingsGroup,
  present: ReadonlySet<SettingsGroup>,
): SettingsGroup[] {
  return [current, ...SETTINGS_GROUPS.filter((g) => g !== current)].filter((g) => present.has(g))
}
