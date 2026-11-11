import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { member, projectMembers } from '#schema/index.ts'

/**
 * SQL: the project may be seen by `userId` (an id, or a column holding one): they belong to it, or they are an owner or admin of
 * its workspace. Callers still check that the person belongs to the workspace (and that it
 * accepts their session); this adds the project-level rule on top.
 */
export function projectVisibleTo(
  userId: string | AnyPgColumn,
  project: { id: AnyPgColumn; workspaceId: AnyPgColumn },
): SQL {
  return sql`(exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${project.id} and ${projectMembers.userId} = ${userId}) or exists (select 1 from ${member} where ${member.workspaceId} = ${project.workspaceId} and ${member.userId} = ${userId} and ${member.role} in ('owner', 'admin')))`
}
