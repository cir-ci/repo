import { createHash, randomBytes } from 'node:crypto'

import { and, eq, exists, gt, lt, sql } from 'drizzle-orm'

import { member, session, siteSessions, siteTokens, projects } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { Database } from '#src/client.ts'

/** The sign-in handoff: single-use tokens and the sessions they open. */

const TOKEN_TTL_MS = 60_000

export const SITE_SESSION_TTL_MS = 60 * 60_000

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** A single-use token for one address, 60 seconds; only its hash is kept. */
export async function createSiteToken(
  db: Database,
  input: { label: string; userId: string; authSessionId: string },
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.delete(siteTokens).where(lt(siteTokens.expiresAt, new Date()))
  await db.insert(siteTokens).values({
    tokenHash: hash(token),
    label: input.label,
    userId: input.userId,
    authSessionId: input.authSessionId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  })
  return token
}

/**
 * Spends a token: valid once, for the address it was made for, within its minute. The deletion is
 * the check, so two requests racing with one token can't both win.
 */
export async function consumeSiteToken(
  db: Database,
  token: string,
  label: string,
): Promise<{ userId: string; authSessionId: string } | undefined> {
  const [row] = await db
    .delete(siteTokens)
    .where(
      and(
        eq(siteTokens.tokenHash, hash(token)),
        eq(siteTokens.label, label),
        gt(siteTokens.expiresAt, new Date()),
      ),
    )
    .returning()
  return row ? { userId: row.userId, authSessionId: row.authSessionId } : undefined
}

export async function createSiteSession(
  db: Database,
  input: { label: string; userId: string; authSessionId: string },
): Promise<string> {
  const id = randomBytes(24).toString('base64url')
  await db.delete(siteSessions).where(lt(siteSessions.expiresAt, new Date()))
  await db.insert(siteSessions).values({
    id,
    label: input.label,
    userId: input.userId,
    authSessionId: input.authSessionId,
    expiresAt: new Date(Date.now() + SITE_SESSION_TTL_MS),
  })
  return id
}

/**
 * Whether a site session still stands for a person who may open this address: the session
 * exists for this address and hasn't expired, the dashboard session behind it is still valid,
 * and the person still belongs to the site's workspace (and sees its project, when `projectId` is given).
 */
export async function siteSessionValid(
  db: Database,
  input: { id: string; label: string; workspaceId: string; projectId?: string },
): Promise<boolean> {
  const [row] = await db
    .select({ userId: siteSessions.userId })
    .from(siteSessions)
    .innerJoin(session, eq(session.id, siteSessions.authSessionId))
    .innerJoin(
      member,
      and(eq(member.userId, siteSessions.userId), eq(member.workspaceId, input.workspaceId)),
    )
    .where(
      and(
        eq(siteSessions.id, input.id),
        eq(siteSessions.label, input.label),
        gt(siteSessions.expiresAt, new Date()),
        gt(session.expiresAt, new Date()),
        // The site belongs to a project: the person must still be able to see it.
        input.projectId === undefined
          ? undefined
          : exists(
              db
                .select({ one: sql`1` })
                .from(projects)
                .where(
                  and(
                    eq(projects.id, input.projectId),
                    projectVisibleTo(siteSessions.userId, projects),
                  ),
                ),
            ),
      ),
    )
  return row !== undefined
}

/** Slides a site session's expiry forward (the cookie lives an hour from the last use). */
export async function touchSiteSession(db: Database, id: string): Promise<void> {
  await db
    .update(siteSessions)
    .set({ expiresAt: new Date(Date.now() + SITE_SESSION_TTL_MS) })
    .where(eq(siteSessions.id, id))
}
