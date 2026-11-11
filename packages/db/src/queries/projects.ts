import { type ProjectColor, workspacePictureUrl } from '@circi/core'
import { and, eq } from 'drizzle-orm'

import { member, workspace, projects } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import { asWorkspaceRole, type WorkspaceRole } from '#shared/workspace-role.ts'
import type { Database } from '#src/client.ts'

import { listBuildsForProject } from './builds.ts'
import { getProjectMemberSummaries } from './project-members.ts'

/**
 * Project read models for the dashboard. Everything a user can reach is limited to the
 * workspaces they're a member of (PLAN §8: workspace isolation).
 */

export interface ProjectOverview {
  workspace: {
    slug: string
    name: string
    picture: string | null
    /** The person's role in the workspace. */
    role: WorkspaceRole
  }
  project: {
    slug: string
    name: string
    defaultBranch: string
    color: ProjectColor
    icon: string | null
    /** People in the project. */
    memberCount: number
    /** The first few members, by name (up to five). */
    memberPreview: { id: string; name: string; image: string | null }[]
    /** Whether the person belongs to the project (an owner or admin may see one they don't). */
    youAreMember: boolean
  }
  latestBuild: listBuildsForProject.Item | null
}

/**
 * The projects `userId` may see (their own, plus every project of the workspaces where they are an
 * owner or admin), with each one's latest build.
 */
export async function listProjectsOverview(
  db: Database,
  userId: string,
  method?: SessionMethod,
): Promise<ProjectOverview[]> {
  const rows = await db
    .select({ workspace: workspace, project: projects, role: member.role })
    .from(projects)
    .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, userId)))
    .where(and(workspaceAccepts(workspace.id, method), projectVisibleTo(userId, projects)))
    .orderBy(workspace.slug, projects.slug)
  const summaries = await getProjectMemberSummaries(
    db,
    rows.map((r) => r.project.id),
    userId,
  )
  return Promise.all(
    rows.map(async ({ workspace: owner, project, role }) => {
      const [latest] = await listBuildsForProject(db, project.id, { limit: 1 })
      return {
        workspace: {
          slug: owner.slug,
          name: owner.name,
          picture: workspacePictureUrl(owner.slug, owner.logo),
          role: asWorkspaceRole(role),
        },
        project: {
          slug: project.slug,
          name: project.name,
          defaultBranch: project.defaultBranch,
          color: project.color,
          icon: project.icon,
          memberCount: summaries.get(project.id)?.memberCount ?? 0,
          memberPreview: summaries.get(project.id)?.memberPreview ?? [],
          youAreMember: summaries.get(project.id)?.youAreMember ?? false,
        },
        latestBuild: latest ?? null,
      }
    }),
  )
}
