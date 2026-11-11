import type { ProjectColor } from '@circi/core'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { member, projectMembers, projects, user } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { Database } from '#src/client.ts'

/** Who belongs to a project, as the Members section, the pickers and the lists show them. */

export const MEMBER_PREVIEW = 5

export namespace listProjectMembers {
  export interface Item {
    id: string
    name: string
    email: string
    image: string | null
    /** The person's role in the project's workspace (roles are workspace-wide). */
    role: 'owner' | 'admin' | 'member'
    addedAt: Date
  }
}

const asRole = (role: string): listProjectMembers.Item['role'] =>
  role === 'owner' || role === 'admin' ? role : 'member'

/** The project's members by name. Anyone who has left the workspace is not listed. */
export async function listProjectMembers(
  db: Database,
  projectId: string,
): Promise<listProjectMembers.Item[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      addedAt: projectMembers.addedAt,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .innerJoin(
      member,
      and(eq(member.workspaceId, projects.workspaceId), eq(member.userId, user.id)),
    )
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(user.name), asc(user.id))
  return rows.map((r) => Object.assign({}, r, { role: asRole(r.role) }))
}

/** Whether the user belongs to the project. */
export async function isProjectMember(
  db: Database,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  return row !== undefined
}

export namespace getProjectMemberSummaries {
  export interface Summary {
    memberCount: number
    /** Up to five, by name. */
    memberPreview: { id: string; name: string; image: string | null }[]
    youAreMember: boolean
  }
}

/** For each project id: how many people belong, the first few, and whether `userId` is one. */
export async function getProjectMemberSummaries(
  db: Database,
  projectIds: readonly string[],
  userId: string,
): Promise<Map<string, getProjectMemberSummaries.Summary>> {
  const out = new Map<string, getProjectMemberSummaries.Summary>()
  if (projectIds.length === 0) return out
  const rows = await db
    .select({
      projectId: projectMembers.projectId,
      id: user.id,
      name: user.name,
      image: user.image,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .innerJoin(
      member,
      and(eq(member.workspaceId, projects.workspaceId), eq(member.userId, user.id)),
    )
    .where(inArray(projectMembers.projectId, [...projectIds]))
    .orderBy(asc(user.name), asc(user.id))
  for (const projectId of projectIds) {
    out.set(projectId, { memberCount: 0, memberPreview: [], youAreMember: false })
  }
  for (const r of rows) {
    const s = out.get(r.projectId)
    if (!s) continue
    s.memberCount += 1
    if (s.memberPreview.length < MEMBER_PREVIEW) {
      s.memberPreview.push({ id: r.id, name: r.name, image: r.image })
    }
    if (r.id === userId) s.youAreMember = true
  }
  return out
}

export namespace listWorkspaceMemberProjects {
  export interface Project {
    slug: string
    name: string
    color: ProjectColor
    icon: string | null
  }
}

/**
 * Which projects each person of a workspace belongs to, limited to the projects `viewerId` may see
 * (all of them for an owner or admin; their own for a member). People in no visible project are
 * left out.
 */
export async function listWorkspaceMemberProjects(
  db: Database,
  input: { workspaceId: string; viewerId: string },
): Promise<Record<string, listWorkspaceMemberProjects.Project[]>> {
  const rows = await db
    .select({
      userId: projectMembers.userId,
      slug: projects.slug,
      name: projects.name,
      color: projects.color,
      icon: projects.icon,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(
      member,
      and(eq(member.workspaceId, projects.workspaceId), eq(member.userId, projectMembers.userId)),
    )
    .where(
      and(eq(projects.workspaceId, input.workspaceId), projectVisibleTo(input.viewerId, projects)),
    )
    .orderBy(asc(projects.name), asc(projects.slug))
  const out: Record<string, listWorkspaceMemberProjects.Project[]> = {}
  for (const r of rows) {
    const list = out[r.userId] ?? []
    out[r.userId] = list
    list.push({ slug: r.slug, name: r.name, color: r.color, icon: r.icon })
  }
  return out
}
