import { eq } from 'drizzle-orm'

import { apikey, teams, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

export namespace getTeamTokenInfo {
  export interface Info {
    /** The start of the token ("circi_AbC1…"); null when the team has no token. */
    hint: string | null
    createdAt: Date | null
    createdBy: { id: string; name: string } | null
    /** When CI last authenticated with it; null if it never has. */
    lastUsedAt: Date | null
  }
}

/**
 * Facts about a team's current CI token, never the token: CirCI stores only its hash (the key
 * row better-auth keeps), plus the first characters it chose to keep for display.
 */
export async function getTeamTokenInfo(
  db: Database,
  teamId: string,
): Promise<getTeamTokenInfo.Info> {
  const [row] = await db
    .select({
      start: apikey.start,
      createdAt: apikey.createdAt,
      lastRequest: apikey.lastRequest,
      creatorId: user.id,
      creatorName: user.name,
    })
    .from(teams)
    .leftJoin(apikey, eq(apikey.id, teams.ciKeyId))
    .leftJoin(user, eq(user.id, teams.ciKeyCreatedBy))
    .where(eq(teams.id, teamId))
  const hasKey = row?.createdAt !== null && row?.createdAt !== undefined
  return {
    // A token made before the dashboard kept more than the prefix has nothing to show.
    hint: hasKey && row.start && row.start.length > 6 ? `${row.start}…` : null,
    createdAt: row?.createdAt ?? null,
    createdBy:
      row?.creatorId && row.creatorName ? { id: row.creatorId, name: row.creatorName } : null,
    lastUsedAt: row?.lastRequest ?? null,
  }
}
