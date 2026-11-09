import { and, asc, eq, max } from 'drizzle-orm'

import { builds, teams, triageRotationMembers, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Triage reads shared by the triage queue (a read model) and the triage repository. */

/** The newest default-branch build number of a team (0 when it has none). */
export async function latestDefaultBranchBuildNumber(
  db: Database,
  teamId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: max(builds.number) })
    .from(builds)
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .where(and(eq(builds.teamId, teamId), eq(builds.branch, teams.defaultBranch)))
  return row?.n ?? 0
}

export namespace getTriageRotation {
  export interface Rotation {
    /** Any moment of the first week; null when the team has no rotation. */
    startsOn: Date | null
    members: { id: string; name: string }[]
  }
}

/** The team's rotation: its members in turn order. */
export async function getTriageRotation(
  db: Database,
  teamId: string,
): Promise<getTriageRotation.Rotation> {
  const [team] = await db
    .select({ startsOn: teams.triageRotationStartsOn })
    .from(teams)
    .where(eq(teams.id, teamId))
  const members = await db
    .select({ id: user.id, name: user.name })
    .from(triageRotationMembers)
    .innerJoin(user, eq(user.id, triageRotationMembers.userId))
    .where(eq(triageRotationMembers.teamId, teamId))
    .orderBy(asc(triageRotationMembers.position))
  return { startsOn: members.length > 0 ? (team?.startsOn ?? null) : null, members }
}
