import { asc, eq, sql } from 'drizzle-orm'

import { integrationTeams, integrations } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A workspace's integrations, as read models and the repository both need them. */

export namespace WorkspaceIntegration {
  export type Record = typeof integrations.$inferSelect

  export type Team = typeof integrationTeams.$inferSelect

  export interface Row {
    id: string
    kind: string
    displayName: string
    needsAttention: boolean
    needsAttentionReason: string | null
    createdAt: Date
    teamCount: number
  }
}

/** The workspace's integrations, oldest first, with how many teams use each. */
export async function listIntegrations(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceIntegration.Row[]> {
  return db
    .select({
      id: integrations.id,
      kind: integrations.kind,
      displayName: integrations.displayName,
      needsAttention: integrations.needsAttention,
      needsAttentionReason: integrations.needsAttentionReason,
      createdAt: integrations.createdAt,
      teamCount: sql<number>`count(${integrationTeams.id})::int`,
    })
    .from(integrations)
    .leftJoin(integrationTeams, eq(integrationTeams.integrationId, integrations.id))
    .where(eq(integrations.workspaceId, workspaceId))
    .groupBy(integrations.id)
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
}
