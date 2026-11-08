import { and, eq, exists, or, sql } from 'drizzle-orm'

import { workspaceAccepts, type SessionMethod } from '#repositories/auth-settings.ts'
import { builds, member, teams, screenshotDiffs, screenshots } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Whether `userId` may download a stored file. Files are shared across workspaces by content
 * hash, so knowing a hash proves nothing: the file must be a screenshot, thumbnail or diff of a
 * build in one of the user's workspaces.
 */
export async function canUserAccessFile(
  db: Database,
  userId: string,
  sha256: string,
  method?: SessionMethod,
): Promise<boolean> {
  const inUsersWorkspace = (buildId: typeof screenshots.buildId | typeof screenshotDiffs.buildId) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(builds)
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .innerJoin(
          member,
          and(eq(member.workspaceId, teams.workspaceId), eq(member.userId, userId)),
        )
        .where(and(eq(builds.id, buildId), workspaceAccepts(teams.workspaceId, method))),
    )
  const [viaScreenshot] = await db
    .select({ one: sql`1` })
    .from(screenshots)
    .where(
      and(
        or(eq(screenshots.fileSha256, sha256), eq(screenshots.thumbnailSha256, sha256)),
        inUsersWorkspace(screenshots.buildId),
      ),
    )
    .limit(1)
  if (viaScreenshot) return true
  const [viaDiff] = await db
    .select({ one: sql`1` })
    .from(screenshotDiffs)
    .where(
      and(eq(screenshotDiffs.diffFileSha256, sha256), inUsersWorkspace(screenshotDiffs.buildId)),
    )
    .limit(1)
  return Boolean(viaDiff)
}
