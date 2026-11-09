import { asc, eq } from 'drizzle-orm'

import { workspaceDomains } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Email domains a workspace claims, and the DNS proof that makes a claim count (PLAN §7.8). */

export type WorkspaceDomain = typeof workspaceDomains.$inferSelect

/** The DNS name that must hold the verification token. */
export const verificationName = (domain: string) => `_circi-verify.${domain}`

/** What the TXT record must contain. */
export const verificationValue = (domain: WorkspaceDomain) =>
  `circi-verify=${domain.verificationToken}`

export async function listWorkspaceDomains(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceDomain[]> {
  return db
    .select()
    .from(workspaceDomains)
    .where(eq(workspaceDomains.workspaceId, workspaceId))
    .orderBy(asc(workspaceDomains.domain))
}
