import type { ProjectColor } from '@circi/core'
import { and, asc, eq, sql } from 'drizzle-orm'

import { member, projectMembers, projects, workspace } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import { type SessionMethod, workspaceAccepts, workspaceIsLive } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'
import { assertFound } from '#src/errors.ts'
import type { Project } from '#src/types.ts'

import { getWorkspaceBySlug } from './workspaces.ts'

/** Finding projects: by slugs, by id, and the role a user holds in a project's workspace. */

export async function listProjects(db: Database, workspaceSlug: string): Promise<Project[]> {
  const found = await getWorkspaceBySlug(db, workspaceSlug)
  return db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, found.id))
    .orderBy(asc(projects.slug))
}

export async function getProjectBySlugs(
  db: Database,
  input: { workspaceSlug: string; projectSlug: string },
): Promise<Project> {
  const [row] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
    .where(and(eq(workspace.slug, input.workspaceSlug), eq(projects.slug, input.projectSlug)))
  assertFound(row, `Project "${input.workspaceSlug}/${input.projectSlug}" not found`)
  return row.project
}

export async function getProjectById(
  db: Database,
  projectId: string,
): Promise<Project | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  return row
}

export namespace getProjectContext {
  export interface Context {
    project: Project
    workspaceSlug: string
  }
}

/** A project plus its workspace slug, which dashboard URLs need; none if its workspace is deleted. */
export async function getProjectContext(
  db: Database,
  projectId: string,
): Promise<getProjectContext.Context | undefined> {
  const [row] = await db
    .select({ project: projects, workspaceSlug: workspace.slug })
    .from(projects)
    .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
    .where(and(eq(projects.id, projectId), workspaceIsLive(workspace.id)))
  return row
}

export namespace findProjectForMember {
  export interface Visible {
    id: string
    slug: string
    name: string
    defaultBranch: string
    color: ProjectColor
    icon: string | null
    workspaceSlug: string
    workspaceName: string
  }
}

/**
 * A project by its URL slugs, only if `userId` may see it: they belong to the project, or are an owner
 * or admin of its workspace. Anyone else gets the same "not found" as for a project that doesn't
 * exist (PLAN §8: workspace isolation; projects are visible to their members).
 */
export async function findProjectForMember(
  db: Database,
  input: findProjectForMember.Input,
): Promise<findProjectForMember.Visible | undefined> {
  return (await findProjectWithAccess(db, input))?.project
}
export namespace findProjectForMember {
  export interface Input {
    workspaceSlug: string
    projectSlug: string
    userId: string
    method?: SessionMethod
  }
}

/**
 * `findProjectForMember`, plus what a request needs to decide on access, from the same query: the
 * user's role in the project's workspace and whether they belong to the project itself.
 */
export async function findProjectWithAccess(
  db: Database,
  input: findProjectForMember.Input,
): Promise<findProjectWithAccess.Found | undefined> {
  const [row] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      defaultBranch: projects.defaultBranch,
      color: projects.color,
      icon: projects.icon,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: member.role,
      isMember: sql<boolean>`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${input.userId})`,
    })
    .from(projects)
    .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(
      and(
        eq(workspace.slug, input.workspaceSlug),
        eq(projects.slug, input.projectSlug),
        workspaceAccepts(workspace.id, input.method),
        projectVisibleTo(input.userId, projects),
      ),
    )
  if (!row) return undefined
  const { role, isMember, ...project } = row
  return { project, role, isMember }
}
export namespace findProjectWithAccess {
  export interface Found {
    project: findProjectForMember.Visible
    /** The user's role in the project's workspace (`owner`, `admin`, `member`). */
    role: string
    /** Whether the user belongs to the project (owners and admins may see it without). */
    isMember: boolean
  }
}

/** The member's role in the project's workspace (`owner`, `admin`, `member`), if they belong. */
export async function getProjectMemberRole(
  db: Database,
  projectId: string,
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ role: member.role })
    .from(projects)
    .innerJoin(member, and(eq(member.workspaceId, projects.workspaceId), eq(member.userId, userId)))
    .where(eq(projects.id, projectId))
  return row?.role
}

export namespace projectSettings {
  export interface Settings {
    name: string
    /** The project's address in the dashboard: `<workspace>/<slug>`. */
    slug: string
    defaultBranch: string
    diffThreshold: number
    autoApproveDefaultBranch: boolean
    blockMergeOnChanges: boolean
    /** Whether flaky-only changes block the merge; null inherits the workspace's setting. */
    flakyBlocksMerge: boolean | null
    /** Whether new triage items go to whoever is on triage; null inherits the workspace's setting. */
    assignTriageToOnCall: boolean | null
    retentionDays: number
    /** Hours a review request may wait before it is overdue; null means no review target. */
    reviewTargetHours: number | null
    /** Also told when a review request misses its target (a project member); null: nobody. */
    reviewOverdueNotifyUserId: string | null
    /** A newer build on a branch closes the older builds' review requests. */
    closeReviewsOnNewerBuild: boolean
    /** A newer build asks the people the older build's requests asked, again. */
    reRequestOnNewerBuild: boolean
    /** A build with no changes passes without anyone approving it. */
    autoApproveNoChanges: boolean
    /** Rejecting needs a written reason. */
    requireRejectReason: boolean
    /** A screenshot is flaky after this many flip-flops in the last 10 default-branch commits. */
    flakyAfterChanges: number
    /** Days a snoozed triage item stays away when the snooze names no date. */
    snoozeDefaultDays: number
    /** Whether CI may upload static sites for this project (needs `STATIC_SITES_HOST`). */
    staticHostingEnabled: boolean
  }
}

export function projectSettings(project: Project): projectSettings.Settings {
  return {
    name: project.name,
    slug: project.slug,
    defaultBranch: project.defaultBranch,
    diffThreshold: project.diffThreshold,
    autoApproveDefaultBranch: project.autoApproveDefaultBranch,
    blockMergeOnChanges: project.blockMergeOnChanges,
    flakyBlocksMerge: project.flakyBlocksMerge,
    assignTriageToOnCall: project.assignTriageToOnCall,
    retentionDays: project.retentionDays,
    reviewTargetHours: project.reviewTargetHours,
    reviewOverdueNotifyUserId: project.reviewOverdueNotifyUserId,
    closeReviewsOnNewerBuild: project.closeReviewsOnNewerBuild,
    reRequestOnNewerBuild: project.reRequestOnNewerBuild,
    autoApproveNoChanges: project.autoApproveNoChanges,
    requireRejectReason: project.requireRejectReason,
    flakyAfterChanges: project.flakyAfterChanges,
    snoozeDefaultDays: project.snoozeDefaultDays,
    staticHostingEnabled: project.staticHostingEnabled,
  }
}
