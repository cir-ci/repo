import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { member, teamMembers } from '#schema/index.ts'

/**
 * SQL: the team may be seen by `userId` (an id, or a column holding one): they belong to it, or they are an owner or admin of
 * its workspace. Callers still check that the person belongs to the workspace (and that it
 * accepts their session); this adds the team-level rule on top.
 */
export function teamVisibleTo(
  userId: string | AnyPgColumn,
  team: { id: AnyPgColumn; workspaceId: AnyPgColumn },
): SQL {
  return sql`(exists (select 1 from ${teamMembers} where ${teamMembers.teamId} = ${team.id} and ${teamMembers.userId} = ${userId}) or exists (select 1 from ${member} where ${member.workspaceId} = ${team.workspaceId} and ${member.userId} = ${userId} and ${member.role} in ('owner', 'admin')))`
}
