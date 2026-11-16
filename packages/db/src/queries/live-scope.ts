import { and, eq, inArray, sql } from 'drizzle-orm'

import { member, projectMembers, projects, workspace } from '#schema/index.ts'
import { type SessionMethod, workspaceAccepts } from '#shared/session-method.ts'
import { asWorkspaceRole, type WorkspaceRole } from '#shared/workspace-role.ts'
import type { Database } from '#src/client.ts'

/**
 * What an open dashboard may hear about: the workspaces the person belongs to (and the session's
 * sign-in method may open), with their role, and the projects in them with whether the person
 * belongs to each. Whether a project is visible is the access policy's call (`canSeeProject`),
 * not this query's; this only gives the policy its facts.
 */
export namespace getLiveScope {
  export interface Workspace {
    id: string
    slug: string
    role: WorkspaceRole
  }
  export interface Project {
    id: string
    slug: string
    workspaceId: string
    /** Whether the person belongs to the project (an owner or admin may see one they don't). */
    isMember: boolean
  }
  export interface Result {
    workspaces: Workspace[]
    projects: Project[]
  }
}

export async function getLiveScope(
  db: Database,
  input: { userId: string; method?: SessionMethod },
): Promise<getLiveScope.Result> {
  const rows = await db
    .select({ id: workspace.id, slug: workspace.slug, role: member.role })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(and(eq(member.userId, input.userId), workspaceAccepts(workspace.id, input.method)))
  if (rows.length === 0) return { workspaces: [], projects: [] }
  const projectRows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      workspaceId: projects.workspaceId,
      isMember: sql<boolean>`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${input.userId})`,
    })
    .from(projects)
    .where(
      inArray(
        projects.workspaceId,
        rows.map((r) => r.id),
      ),
    )
  return {
    workspaces: rows.map((r) => ({ id: r.id, slug: r.slug, role: asWorkspaceRole(r.role) })),
    projects: projectRows,
  }
}
