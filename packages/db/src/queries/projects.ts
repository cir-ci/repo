import { and, eq } from 'drizzle-orm'

import { orgAccepts, type SessionMethod } from '#repositories/auth-settings.ts'
import { member, organization, projects } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

import { listBuildsForProject } from './builds.ts'

/**
 * Project read models for the dashboard. Everything a user can reach is limited to the
 * organizations they're a member of (PLAN §8: org isolation).
 */

export interface ProjectOverview {
  org: { slug: string; name: string }
  project: { slug: string; name: string; defaultBranch: string }
  latestBuild: listBuildsForProject.Item | null
}

/** Projects in the organizations `userId` belongs to, with each one's latest build. */
export async function listProjectsOverview(
  db: Database,
  userId: string,
  method?: SessionMethod,
): Promise<ProjectOverview[]> {
  const rows = await db
    .select({ org: organization, project: projects })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
    .where(orgAccepts(organization.id, method))
    .orderBy(organization.slug, projects.slug)
  return Promise.all(
    rows.map(async ({ org, project }) => {
      const [latest] = await listBuildsForProject(db, project.id, { limit: 1 })
      return {
        org: { slug: org.slug, name: org.name },
        project: { slug: project.slug, name: project.name, defaultBranch: project.defaultBranch },
        latestBuild: latest ?? null,
      }
    }),
  )
}
