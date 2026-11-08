import { and, eq, exists, or, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { orgAccepts, type SessionMethod } from '../repositories/auth-settings.ts'
import { builds, member, projects, screenshotDiffs, screenshots } from '../schema/index.ts'

/**
 * Whether `userId` may download a stored file. Files are shared across organizations by content
 * hash, so knowing a hash proves nothing: the file must be a screenshot, thumbnail or diff of a
 * build in one of the user's organizations.
 */
export async function canUserAccessFile(
  db: Database,
  userId: string,
  sha256: string,
  method?: SessionMethod,
): Promise<boolean> {
  const inUsersOrg = (buildId: typeof screenshots.buildId | typeof screenshotDiffs.buildId) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(builds)
        .innerJoin(projects, eq(projects.id, builds.projectId))
        .innerJoin(
          member,
          and(eq(member.organizationId, projects.orgId), eq(member.userId, userId)),
        )
        .where(and(eq(builds.id, buildId), orgAccepts(projects.orgId, method))),
    )
  const [viaScreenshot] = await db
    .select({ one: sql`1` })
    .from(screenshots)
    .where(
      and(
        or(eq(screenshots.fileSha256, sha256), eq(screenshots.thumbnailSha256, sha256)),
        inUsersOrg(screenshots.buildId),
      ),
    )
    .limit(1)
  if (viaScreenshot) return true
  const [viaDiff] = await db
    .select({ one: sql`1` })
    .from(screenshotDiffs)
    .where(and(eq(screenshotDiffs.diffFileSha256, sha256), inUsersOrg(screenshotDiffs.buildId)))
    .limit(1)
  return Boolean(viaDiff)
}
