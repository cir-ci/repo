/**
 * The TanStack Query keys, one function per resource, so a key's tuple exists once and an
 * invalidation in another feature cannot drift from the query it targets. A function called with
 * fewer arguments returns a prefix (`keys.triage()` matches every project's queue).
 */

import type { QueryClient } from '@tanstack/react-query'

type Key = readonly unknown[]

export const keys = {
  // Projects and their pages.
  projects: () => ['projects'] as const,
  /** A project's builds page; `page` is `before`, then the filters and the order (see `projectBuildsQuery`). */
  project: (workspace: string, project: string, ...page: unknown[]) =>
    ['project', workspace, project, ...page] as const,
  projectSettings: (workspace: string, project: string) =>
    ['settings', workspace, project] as const,
  /** Every project's settings (the prefix of `projectSettings`). */
  allProjectSettings: () => ['settings'] as const,
  projectMembers: (workspace: string, project: string) =>
    ['project-members', workspace, project] as const,
  token: (workspace: string, project: string) => ['token', workspace, project] as const,
  ignoreRegions: (workspace: string, project: string) =>
    ['ignore-regions', workspace, project] as const,
  flaky: (workspace: string, project: string) => ['flaky', workspace, project] as const,
  baselines: (workspace: string, project: string) => ['baselines', workspace, project] as const,
  sites: (workspace: string, project: string) => ['project-sites', workspace, project] as const,
  rules: (workspace: string, project: string) => ['rules', workspace, project] as const,
  triage: (workspace?: string, project?: string) =>
    (workspace === undefined ? ['triage'] : ['triage', workspace, project]) as Key,
  snapshotHistory: (workspace: string, project: string, name: string, build: unknown) =>
    ['snapshot-history', workspace, project, name, build] as const,

  // A build.
  build: (workspace: string, project: string, number: unknown) =>
    ['build', workspace, project, number] as const,
  /** Every build page of a project (the prefix of `build`). */
  projectBuildPages: (workspace: string, project: string) => ['build', workspace, project] as const,
  comments: (workspace: string, project: string, number: unknown) =>
    ['comments', workspace, project, number] as const,
  activity: (workspace: string, project: string, number: unknown) =>
    ['activity', workspace, project, number] as const,
  issues: (workspace: string, project: string, number: unknown) =>
    ['issues', workspace, project, number] as const,

  // Workspaces.
  workspace: (workspace: string) => ['workspace', workspace] as const,
  workspaceGeneral: (workspace: string) => ['workspace-general', workspace] as const,
  /** The projects each workspace member is in. */
  memberProjects: (workspace: string) => ['member-projects', workspace] as const,
  memberSignIn: (workspace: string) => ['member-sign-in', workspace] as const,
  workspaceStorage: (workspace: string) => ['workspace-storage', workspace] as const,
  workspaceAuth: (workspace: string) => ['workspace-auth', workspace] as const,
  workspaceSettings: (workspace: string) => ['workspace-settings', workspace] as const,
  workspaceDomains: (workspace: string) => ['workspace-domains', workspace] as const,
  workspaceSso: (workspace: string) => ['workspace-sso', workspace] as const,
  /** A workspace's builds page; `page` is `before`, then the filters and the order. */
  workspaceBuilds: (workspace: string, ...page: unknown[]) =>
    ['workspace-builds', workspace, ...page] as const,
  buildSuggestions: (workspace: string, field: string, text: string) =>
    ['build-suggestions', workspace, field, text] as const,
  branches: (workspace: string, project: string | null, text: string) =>
    ['branches', workspace, project, text] as const,
  views: (workspace: string) => ['views', workspace] as const,
  /** The sidebar of one workspace, or (no argument) of all of them. */
  sidebar: (workspace?: string) =>
    (workspace === undefined ? ['sidebar'] : ['sidebar', workspace]) as Key,
  search: (workspace: string, q: string, scope?: unknown) =>
    ['search', workspace, q, scope ?? null] as const,
  insights: (workspace: string, project: string | null, from: unknown, to: unknown) =>
    ['insights', workspace, project, from, to] as const,
  /** Integrations of a workspace; `rest` narrows to a mapping, targets or links. */
  integrations: (workspace: string, ...rest: unknown[]) =>
    ['integrations', workspace, ...rest] as const,
  capabilities: () => ['capabilities'] as const,
  /** The GitHub repositories of a workspace that no project is linked to (Import from GitHub). */
  githubImport: (workspace: string) => ['github-import', workspace] as const,

  // The signed-in user.
  reviews: (tab?: string) => (tab === undefined ? ['reviews'] : ['reviews', tab]) as Key,
  inbox: (tab?: string) => (tab === undefined ? ['inbox'] : ['inbox', tab]) as Key,
  notificationPreferences: () => ['notification-preferences'] as const,
  pushDevices: () => ['push-devices'] as const,
  sessions: () => ['sessions'] as const,
  linkedAccounts: () => ['linked-accounts'] as const,
  emailChange: () => ['email-change'] as const,
  authMethods: () => ['auth-methods'] as const,
  setup: () => ['setup'] as const,

  // The instance admin.
  instanceNotices: () => ['instance-notices'] as const,
  instanceGithubApp: () => ['instance-github-app'] as const,
  instanceAccounts: (search?: unknown) =>
    (search === undefined ? ['instance-accounts'] : ['instance-accounts', search]) as Key,
  instanceWorkspaces: () => ['instance-workspaces'] as const,
  instanceSettings: () => ['instance-settings'] as const,
  /** Every health query, or one of `checks`, `checklist`, `queues`. */
  instanceHealth: (part?: 'checks' | 'checklist' | 'queues') =>
    (part === undefined ? ['instance-health'] : ['instance-health', part]) as Key,
}

/** Refetches every query matching one of `targets`; resolves when all of them have. */
export const invalidateAll = (queryClient: QueryClient, ...targets: Key[]) =>
  Promise.all(targets.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
