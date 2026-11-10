/**
 * The TanStack Query keys, one function per resource, so a key's tuple exists once and an
 * invalidation in another feature cannot drift from the query it targets. A function called with
 * fewer arguments returns a prefix (`keys.triage()` matches every team's queue).
 */

import type { QueryClient } from '@tanstack/react-query'

type Key = readonly unknown[]

export const keys = {
  // Teams and their pages.
  teams: () => ['teams'] as const,
  /** A team's builds page; `page` is `before`, then the filters and the order (see `teamBuildsQuery`). */
  team: (workspace: string, team: string, ...page: unknown[]) =>
    ['team', workspace, team, ...page] as const,
  teamSettings: (workspace: string, team: string) => ['settings', workspace, team] as const,
  /** Every team's settings (the prefix of `teamSettings`). */
  allTeamSettings: () => ['settings'] as const,
  teamMembers: (workspace: string, team: string) => ['team-members', workspace, team] as const,
  token: (workspace: string, team: string) => ['token', workspace, team] as const,
  ignoreRegions: (workspace: string, team: string) => ['ignore-regions', workspace, team] as const,
  flaky: (workspace: string, team: string) => ['flaky', workspace, team] as const,
  baselines: (workspace: string, team: string) => ['baselines', workspace, team] as const,
  sites: (workspace: string, team: string) => ['team-sites', workspace, team] as const,
  rules: (workspace: string, team: string) => ['rules', workspace, team] as const,
  triage: (workspace?: string, team?: string) =>
    (workspace === undefined ? ['triage'] : ['triage', workspace, team]) as Key,
  snapshotHistory: (workspace: string, team: string, name: string, build: unknown) =>
    ['snapshot-history', workspace, team, name, build] as const,

  // A build.
  build: (workspace: string, team: string, number: unknown) =>
    ['build', workspace, team, number] as const,
  comments: (workspace: string, team: string, number: unknown) =>
    ['comments', workspace, team, number] as const,
  activity: (workspace: string, team: string, number: unknown) =>
    ['activity', workspace, team, number] as const,
  issues: (workspace: string, team: string, number: unknown) =>
    ['issues', workspace, team, number] as const,

  // Workspaces.
  workspace: (workspace: string) => ['workspace', workspace] as const,
  workspaceGeneral: (workspace: string) => ['workspace-general', workspace] as const,
  /** The teams each workspace member is in. */
  memberTeams: (workspace: string) => ['member-teams', workspace] as const,
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
  branches: (workspace: string, team: string | null, text: string) =>
    ['branches', workspace, team, text] as const,
  views: (workspace: string) => ['views', workspace] as const,
  /** The sidebar of one workspace, or (no argument) of all of them. */
  sidebar: (workspace?: string) =>
    (workspace === undefined ? ['sidebar'] : ['sidebar', workspace]) as Key,
  search: (workspace: string, q: string) => ['search', workspace, q] as const,
  insights: (workspace: string, team: string | null, from: unknown, to: unknown) =>
    ['insights', workspace, team, from, to] as const,
  /** Integrations of a workspace; `rest` narrows to a mapping, targets or links. */
  integrations: (workspace: string, ...rest: unknown[]) =>
    ['integrations', workspace, ...rest] as const,
  capabilities: () => ['capabilities'] as const,
  /** The GitHub repositories of a workspace that no team is linked to (Import from GitHub). */
  githubImport: (workspace: string) => ['github-import', workspace] as const,

  // The signed-in user.
  reviews: (tab?: string) => (tab === undefined ? ['reviews'] : ['reviews', tab]) as Key,
  inbox: (tab?: string) => (tab === undefined ? ['inbox'] : ['inbox', tab]) as Key,
  notificationPreferences: () => ['notification-preferences'] as const,
  sessions: () => ['sessions'] as const,
  linkedAccounts: () => ['linked-accounts'] as const,
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
