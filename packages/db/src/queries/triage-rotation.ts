import { and, asc, eq, max } from 'drizzle-orm'

import { builds, projects, triageRotationMembers, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Triage reads shared by the triage queue (a read model) and the triage repository. */

/** The newest default-branch build number of a project (0 when it has none). */
export async function latestDefaultBranchBuildNumber(
  db: Database,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: max(builds.number) })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .where(and(eq(builds.projectId, projectId), eq(builds.branch, projects.defaultBranch)))
  return row?.n ?? 0
}

export namespace getTriageRotation {
  export interface Rotation {
    /** Any moment of the first week; null when the project has no rotation. */
    startsOn: Date | null
    members: { id: string; name: string; image: string | null }[]
  }
}

/** The project's rotation: its members in turn order. */
export async function getTriageRotation(
  db: Database,
  projectId: string,
): Promise<getTriageRotation.Rotation> {
  const [project] = await db
    .select({ startsOn: projects.triageRotationStartsOn })
    .from(projects)
    .where(eq(projects.id, projectId))
  const members = await db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(triageRotationMembers)
    .innerJoin(user, eq(user.id, triageRotationMembers.userId))
    .where(eq(triageRotationMembers.projectId, projectId))
    .orderBy(asc(triageRotationMembers.position))
  return { startsOn: members.length > 0 ? (project?.startsOn ?? null) : null, members }
}
