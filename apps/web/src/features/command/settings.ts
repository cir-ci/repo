import { isPhone } from '#lib/use-phone.ts'

import type { Entry, IconKey } from './entry.ts'

/**
 * Settings inside the command menu. Settings is a closed area (CLAUDE.md): outside it the menu
 * lists a section only when the query names it (`Settings · Members`); inside it the menu offers
 * that frame's sections and the way back and nothing of the app, whatever is typed.
 */

export const IN_SETTINGS = 'In settings'
export const LEAVE_SETTINGS = 'Leave settings'

const enc = encodeURIComponent

export interface SettingsSection {
  id: string
  label: string
  /** Which part of the frame: Account, Workspace, Team or Instance. */
  area: 'Account' | 'Workspace' | 'Team' | 'Instance'
  path: string
  icon: IconKey
}

export interface SettingsInput {
  workspace: string | undefined
  /** The team of the address, for its settings pages. */
  team?: string | undefined
  canManage: boolean | undefined
  instanceAdmin: boolean | undefined
}

const ACCOUNT: SettingsSection[] = [
  { id: 'profile', label: 'Profile', area: 'Account', path: '/account/profile', icon: 'person' },
  {
    id: 'notifications',
    label: 'Notifications',
    area: 'Account',
    path: '/account/notifications',
    icon: 'bell',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    area: 'Account',
    path: '/account/appearance',
    icon: 'theme',
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    area: 'Account',
    path: '/account/shortcuts',
    icon: 'keyboard',
  },
]

const INSTANCE: SettingsSection[] = [
  {
    id: 'overview',
    label: 'Instance',
    area: 'Instance',
    path: '/instance/overview',
    icon: 'settings',
  },
  {
    id: 'workspaces',
    label: 'All workspaces',
    area: 'Instance',
    path: '/instance/workspaces',
    icon: 'workspace',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    area: 'Instance',
    path: '/instance/accounts',
    icon: 'person',
  },
  {
    id: 'instance',
    label: 'Instance settings',
    area: 'Instance',
    path: '/instance/settings',
    icon: 'settings',
  },
  { id: 'health', label: 'Health', area: 'Instance', path: '/instance/health', icon: 'status' },
]

const workspaceSection = (
  id: string,
  label: string,
  path: string,
  icon: IconKey,
): SettingsSection => ({ id: `workspace-${id}`, label, area: 'Workspace', path, icon })

/** The settings pages the person has: the same as the settings frame's own navigation lists. */
export function settingsSections({
  workspace,
  team,
  canManage,
  instanceAdmin,
}: SettingsInput): SettingsSection[] {
  // Keyboard shortcuts are for a keyboard: a phone doesn't list them.
  const sections = isPhone() ? ACCOUNT.filter((s) => s.id !== 'shortcuts') : [...ACCOUNT]
  if (workspace) {
    const base = `/workspaces/${enc(workspace)}/settings`
    // Instance admins have the workspace's hub, then its pages (General is at its own address).
    if (instanceAdmin)
      sections.push(workspaceSection('hub', 'Workspace settings', base, 'workspace'))
    if (canManage)
      sections.push(workspaceSection('general', 'General', `${base}/general`, 'workspace'))
    sections.push(workspaceSection('members', 'Members', `${base}/members`, 'person'))
    sections.push(workspaceSection('teams', 'Teams', `${base}/teams`, 'layers'))
    if (canManage) {
      sections.push(workspaceSection('sign-in', 'Sign-in and domains', `${base}/sign-in`, 'check'))
      sections.push(
        workspaceSection('integrations', 'Integrations', `${base}/integrations`, 'sliders'),
      )
      sections.push(
        workspaceSection('storage', 'Storage and retention', `${base}/storage`, 'layers'),
      )
    }
    if (team) {
      const t = (id: string, label: string, sub: string, icon: IconKey): SettingsSection => ({
        id: `team-${id}`,
        label,
        area: 'Team',
        path: `/${enc(workspace)}/${enc(team)}/settings${sub}`,
        icon,
      })
      // The team's hub, then its pages (each opens inside settings, under the hub).
      sections.push(t('hub', 'Team settings', '', 'team'))
      if (canManage) sections.push(t('general', 'General', '/general', 'team'))
      sections.push(t('members', 'Members', '/members', 'person'))
      if (canManage) sections.push(t('reviews', 'Review rules', '/reviews', 'eye'))
      if (canManage) sections.push(t('webhooks', 'Webhooks', '/webhooks', 'sliders'))
      sections.push(t('ignore-regions', 'Ignore regions', '/ignore-regions', 'image'))
    }
  }
  if (instanceAdmin) sections.push(...INSTANCE)
  return sections
}

const WORDS = ['settings', 'setting']

/** Whether typed text asks for settings: the word itself, or a section's name. */
export function matchesSettings(query: string, section: SettingsSection): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return false
  return (
    WORDS.some((w) => w.startsWith(q) || q.startsWith(w)) ||
    section.label.toLowerCase().includes(q) ||
    `${section.area} ${section.label}`.toLowerCase().includes(q)
  )
}

/** The people's way back out: the frame's own "Back to app". */
export const LEAVE_PATH = '/inbox'

/** A section as a row: `Settings · Members` outside settings, the plain name inside. */
export function sectionEntry(
  section: SettingsSection,
  options: { inside: boolean; current: boolean },
): Entry {
  const label = options.inside ? section.label : `Settings · ${section.label}`
  return {
    id: `settings:${section.id}`,
    group: options.inside ? IN_SETTINGS : 'Settings',
    kind: 'setting',
    label,
    ...(options.inside
      ? { detail: options.current ? `${section.area} · Current` : section.area }
      : { kindLabel: 'Settings' }),
    icon: 'settings',
    target: { type: 'path', path: section.path },
    path: section.path,
    peek: {
      kind: 'Settings',
      title: label,
      lines: [`Opens ${section.label} in ${section.area.toLowerCase()} settings.`],
      rows: [],
    },
    keywords: ['settings', section.area.toLowerCase()],
  }
}
