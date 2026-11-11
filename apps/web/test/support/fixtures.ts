import type { Sidebar, Project } from '@circi/api'

import type { SessionUser } from '#lib/auth-client.ts'

/** `project.info` as the API returns it: the "web" project of the "acme" workspace. */
export const projectInfo = (over: Partial<Project.Info> = {}): Project.Info => ({
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

/** One project of the sidebar (a project row's appearance and counts). */
export const sidebarProject = (over: Partial<Sidebar.Project> = {}): Sidebar.Project => ({
  slug: 'web',
  name: 'Web App',
  color: 'slate',
  icon: null,
  pinned: false,
  triage: 0,
  memberCount: 3,
  memberPreview: [],
  siteCount: 0,
  youAreMember: true,
  ...over,
})

/** `GET /api/workspaces/:workspace/sidebar`: the web project, no views, nothing unread. */
export const sidebarModel = (over: Partial<Sidebar.Model> = {}): Sidebar.Model => ({
  projects: [sidebarProject()],
  views: [],
  inboxUnread: 0,
  reviews: 0,
  triageAssigned: 0,
  canManage: true,
  ...over,
})

/** One entry of `GET /api/projects`: a project of a workspace, with its people (three members, you among them). */
export const overview = (
  workspace: string,
  project: string,
  over: Partial<Project.Overview['project']> = {},
): Project.Overview => ({
  workspace: { slug: workspace, name: workspace.toUpperCase(), picture: null, role: 'owner' },
  project: {
    slug: project,
    name: project,
    defaultBranch: 'main',
    color: 'slate',
    icon: null,
    memberCount: 3,
    memberPreview: [
      { id: 'u1', name: 'Ada Lovelace', image: null },
      { id: 'u2', name: 'Grace Hopper', image: null },
      { id: 'u3', name: 'Alan Turing', image: null },
    ],
    youAreMember: true,
    ...over,
  },
  latestBuild: null,
})

/** The session of `user`, as better-auth's `useSession` returns it. */
export const sessionFor = (user: SessionUser) => ({ data: { user }, isPending: false })
