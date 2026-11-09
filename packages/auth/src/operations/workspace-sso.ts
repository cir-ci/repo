import { type Database, schema } from '@circi/db'
import { eq } from 'drizzle-orm'

/** The single sign-on providers registered for a workspace (secrets are never selected). */
export async function listWorkspaceSsoProviders(
  db: Database,
  workspaceId: string,
): Promise<{ providerId: string; issuer: string }[]> {
  return db
    .select({ providerId: schema.ssoProvider.providerId, issuer: schema.ssoProvider.issuer })
    .from(schema.ssoProvider)
    .where(eq(schema.ssoProvider.workspaceId, workspaceId))
}

/** The workspace a provider belongs to, or undefined when there is no such provider. */
export async function findSsoProviderWorkspaceId(
  db: Database,
  providerId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ workspaceId: schema.ssoProvider.workspaceId })
    .from(schema.ssoProvider)
    .where(eq(schema.ssoProvider.providerId, providerId))
  return row?.workspaceId ?? undefined
}
