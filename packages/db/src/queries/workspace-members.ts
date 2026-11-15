import { eq } from 'drizzle-orm'

import { account, member, ssoProvider } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

export namespace listMemberSignIn {
  export interface Item {
    userId: string
    /**
     * How the person can sign in: `password`, `sso` (the workspace's own provider), or the
     * provider of a linked account (`github`, `google`, `oidc`…), password first, then A to Z.
     * Email codes leave no trace on the account, so they are not listed.
     */
    methods: string[]
  }
}

/** Each member of a workspace with the sign-in methods their linked accounts give them. */
export async function listMemberSignIn(
  db: Database,
  workspaceId: string,
): Promise<listMemberSignIn.Item[]> {
  const rows = await db
    .select({ userId: member.userId, providerId: account.providerId })
    .from(member)
    .leftJoin(account, eq(account.userId, member.userId))
    .where(eq(member.workspaceId, workspaceId))
  const own = new Set(
    (
      await db
        .select({ providerId: ssoProvider.providerId })
        .from(ssoProvider)
        .where(eq(ssoProvider.workspaceId, workspaceId))
    ).map((p) => p.providerId),
  )
  const byUser = new Map<string, Set<string>>()
  for (const row of rows) {
    const methods = byUser.get(row.userId) ?? new Set<string>()
    byUser.set(row.userId, methods)
    if (row.providerId === null) continue
    methods.add(
      row.providerId === 'credential'
        ? 'password'
        : own.has(row.providerId)
          ? 'sso'
          : row.providerId,
    )
  }
  return [...byUser].map(([userId, methods]) => ({
    userId,
    methods: [...methods].toSorted((a, b) =>
      a === 'password' ? -1 : b === 'password' ? 1 : a.localeCompare(b),
    ),
  }))
}

/** Everyone in a workspace with their role (`owner`, `admin`, `member`). */
export async function listWorkspaceMemberRoles(
  db: Database,
  workspaceId: string,
): Promise<{ userId: string; role: string }[]> {
  return db
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.workspaceId, workspaceId))
}
