import type { Sidebar, Team } from '@circi/api'

import type { SessionUser } from '#lib/auth-client.ts'

/** `team.info` as the API returns it: the "web" team of the "acme" workspace. */
export const teamInfo = (over: Partial<Team.Info> = {}): Team.Info => ({
  id: 'p1',
  slug: 'web',
  name: 'Web App',
  defaultBranch: 'main',
  color: 'slate',
  icon: null,
  workspaceSlug: 'acme',
  workspaceName: 'Acme Inc',
  ...over,
})

/** One team of the sidebar (a team row's appearance and counts). */
export const sidebarTeam = (over: Partial<Sidebar.Team> = {}): Sidebar.Team => ({
  slug: 'web',
  name: 'Web App',
  color: 'slate',
  icon: null,
  pinned: false,
  triage: 0,
  ...over,
})

/** `GET /api/workspaces/:workspace/sidebar`: the web team, no views, nothing unread. */
export const sidebarModel = (over: Partial<Sidebar.Model> = {}): Sidebar.Model => ({
  teams: [sidebarTeam()],
  views: [],
  inboxUnread: 0,
  reviews: 0,
  canManage: true,
  ...over,
})

/** The session of `user`, as better-auth's `useSession` returns it. */
export const sessionFor = (user: SessionUser) => ({ data: { user }, isPending: false })
